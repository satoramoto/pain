//! Read-only host telemetry. The engine's Linux VM has its own memory and CPU
//! accounting; none of these machine-wide counters describe that VM alone.

#[cfg(target_os = "macos")]
mod macos {
    use core_foundation::{
        base::{CFAllocatorRef, CFType, CFTypeRef, TCFType},
        dictionary::{CFDictionary, CFDictionaryRef, CFMutableDictionaryRef},
        number::CFNumber,
        string::{CFString, CFStringRef},
    };
    use serde_json::{json, Value};
    use std::{ffi::CStr, mem, ptr, sync::{Mutex, OnceLock}, time::Instant};

    const GIB: f64 = 1024.0 * 1024.0 * 1024.0;

    #[derive(Default)]
    pub struct Sampler {
        previous_cpu: Mutex<Option<([u32; 4], Instant)>>,
    }

    impl Sampler {
        /// Called on Tauri's blocking worker, independently of engine operations.
        /// Native calls only: no sudo, subprocesses, sleep or background sampler.
        pub fn snapshot(&self) -> Value {
            let (cpu, interval) = self.cpu_usage();
            json!({
                "telemetry_scope": "macos-host",
                "memory": memory(),
                "swap": swap(),
                "hardware": {
                    "cpu_busy_pct": cpu, "cpu_sample_seconds": interval,
                    "gpu_busy_pct": gpu_usage(),
                    "source": "macOS host",
                    "cpu_source": "Mach host CPU tick deltas",
                    "gpu_source": "IOAccelerator Device Utilization % (busiest available GPU)"
                }
            })
        }

        fn cpu_usage(&self) -> (Option<f64>, Option<f64>) {
            let mut previous = match self.previous_cpu.lock() {
                Ok(previous) => previous,
                Err(_) => return (None, None),
            };
            let current = cpu_ticks().map(|ticks| (ticks, Instant::now()));
            let old = mem::replace(&mut *previous, current);
            let (Some((ticks, now)), Some((before, then))) = (current, old) else {
                return (None, None);
            };
            // Like agentmon's MachineLoad, a reset/wrap leaves the interval unknown.
            let Some(delta) = ticks.iter().zip(before).map(|(a, b)| a.checked_sub(b))
                .collect::<Option<Vec<_>>>() else { return (None, None); };
            let total: u64 = delta.iter().map(|ticks| u64::from(*ticks)).sum();
            if total == 0 { return (None, None); }
            let busy = total - u64::from(delta[libc::CPU_STATE_IDLE as usize]);
            (Some(busy as f64 / total as f64 * 100.0), Some(now.duration_since(then).as_secs_f64()))
        }
    }

    fn host() -> libc::mach_port_t {
        extern "C" { fn mach_host_self() -> libc::mach_port_t; }
        static HOST: OnceLock<libc::mach_port_t> = OnceLock::new();
        // mach_host_self returns a send right; retain one for the process lifetime.
        *HOST.get_or_init(|| unsafe { mach_host_self() })
    }

    fn sysctl_integer(name: &CStr) -> Option<u64> {
        let mut bytes = [0_u8; 8];
        let mut length = bytes.len();
        // The output buffer is valid for `length` bytes; this is a read-only call.
        let result = unsafe {
            libc::sysctlbyname(name.as_ptr(), bytes.as_mut_ptr().cast(), &mut length, ptr::null_mut(), 0)
        };
        if result != 0 { return None; }
        match length {
            4 => Some(u64::from(u32::from_ne_bytes(bytes[..4].try_into().ok()?))),
            8 => Some(u64::from_ne_bytes(bytes)),
            _ => None,
        }
    }

    pub fn memory_capacity() -> Option<u64> {
        sysctl_integer(c"hw.memsize").filter(|bytes| *bytes > 0)
    }

    fn memory() -> Option<Value> {
        let total = memory_capacity()?;
        let page_size = sysctl_integer(c"hw.pagesize").filter(|bytes| *bytes > 0)?;
        // libc's buffer includes newer revisions; only the stable first 38 words
        // are needed for the app/wired/compressed breakdown used by agentmon.
        let mut info: libc::vm_statistics64 = unsafe { mem::zeroed() };
        let mut count = libc::HOST_VM_INFO64_COUNT;
        let result = unsafe {
            libc::host_statistics64(host(), libc::HOST_VM_INFO64, (&mut info as *mut libc::vm_statistics64).cast(), &mut count)
        };
        if result != libc::KERN_SUCCESS || count < 38 { return None; }
        let internal = sysctl_integer(c"vm.page_pageable_internal_count")
            .unwrap_or(u64::from(info.internal_page_count));
        let app = internal.saturating_sub(u64::from(info.purgeable_count)) * page_size;
        let wired = u64::from(info.wire_count) * page_size;
        let compressed = u64::from(info.compressor_page_count) * page_size;
        Some(json!({
            "total_gib": total as f64 / GIB,
            "used_gib": (app + wired + compressed) as f64 / GIB,
            "app_gib": app as f64 / GIB, "wired_gib": wired as f64 / GIB,
            "compressed_gib": compressed as f64 / GIB,
            "source": "macOS host: app + wired + compressed memory"
        }))
    }

    fn swap() -> Option<Value> {
        let mut usage: libc::xsw_usage = unsafe { mem::zeroed() };
        let mut length = mem::size_of_val(&usage);
        let result = unsafe {
            libc::sysctlbyname(c"vm.swapusage".as_ptr(), (&mut usage as *mut libc::xsw_usage).cast(),
                               &mut length, ptr::null_mut(), 0)
        };
        if result != 0 || length != mem::size_of_val(&usage) { return None; }
        Some(json!({
            "kind": "macos", "source": "macOS host vm.swapusage",
            "total_gib": usage.xsu_total as f64 / GIB,
            "used_gib": usage.xsu_used as f64 / GIB,
            "free_gib": usage.xsu_avail as f64 / GIB
        }))
    }

    fn cpu_ticks() -> Option<[u32; 4]> {
        let mut info: libc::host_cpu_load_info = unsafe { mem::zeroed() };
        let mut count = libc::HOST_CPU_LOAD_INFO_COUNT;
        let result = unsafe {
            libc::host_statistics(host(), libc::HOST_CPU_LOAD_INFO, (&mut info as *mut libc::host_cpu_load_info).cast(), &mut count)
        };
        (result == libc::KERN_SUCCESS && count == libc::HOST_CPU_LOAD_INFO_COUNT).then_some(info.cpu_ticks)
    }

    #[link(name = "IOKit", kind = "framework")]
    extern "C" {
        fn IOServiceMatching(name: *const std::ffi::c_char) -> CFMutableDictionaryRef;
        fn IOServiceGetMatchingServices(port: u32, matching: CFDictionaryRef, iterator: *mut u32) -> i32;
        fn IOIteratorNext(iterator: u32) -> u32;
        fn IOObjectRelease(object: u32) -> i32;
        fn IORegistryEntryCreateCFProperty(entry: u32, key: CFStringRef, allocator: CFAllocatorRef, options: u32) -> CFTypeRef;
    }

    struct IoObject(u32);
    impl Drop for IoObject {
        fn drop(&mut self) { unsafe { IOObjectRelease(self.0); } }
    }

    fn gpu_usage() -> Option<f64> {
        // IOKit's public registry API exposes a driver-sampled utilization counter
        // on supported GPUs. Missing counters stay unknown; this is not VM load.
        let matching = unsafe { IOServiceMatching(c"IOAccelerator".as_ptr()) };
        if matching.is_null() { return None; }
        let mut iterator = 0;
        // This call consumes the matching dictionary's reference, even on failure.
        if unsafe { IOServiceGetMatchingServices(0, matching, &mut iterator) } != 0 || iterator == 0 {
            return None;
        }
        let iterator = IoObject(iterator);
        let statistics = CFString::new("PerformanceStatistics");
        let utilization = CFString::new("Device Utilization %");
        let mut busiest: Option<f64> = None;
        loop {
            let service = unsafe { IOIteratorNext(iterator.0) };
            if service == 0 { break; }
            let service = IoObject(service);
            let property = unsafe { IORegistryEntryCreateCFProperty(service.0, statistics.as_concrete_TypeRef(), ptr::null(), 0) };
            if property.is_null() { continue; }
            let property = unsafe { CFType::wrap_under_create_rule(property) };
            let Some(values) = property.downcast::<CFDictionary>() else { continue; };
            let Some(value) = values.find(utilization.as_CFTypeRef()) else { continue; };
            let value = unsafe { CFType::wrap_under_get_rule(*value) };
            let Some(percent) = value.downcast::<CFNumber>().and_then(|number| number.to_f64()) else { continue; };
            if percent.is_finite() && (0.0..=100.0).contains(&percent) {
                busiest = Some(busiest.map_or(percent, |previous| previous.max(percent)));
            }
        }
        busiest
    }
}

#[cfg(target_os = "macos")]
pub use macos::{memory_capacity, Sampler};

#[cfg(not(target_os = "macos"))]
#[derive(Default)]
pub struct Sampler;
#[cfg(not(target_os = "macos"))]
impl Sampler {
    pub fn snapshot(&self) -> serde_json::Value { serde_json::json!({}) }
}
#[cfg(not(target_os = "macos"))]
pub fn memory_capacity() -> Option<u64> { None }
