# Sourced by PAIN's Mac entry points. No global container configuration is changed.
pain_data=${PAIN_DATA_DIR:-"$HOME/Library/Application Support/PAIN"}
pain_runtime="$pain_data/runtime/current"
export PATH="/opt/podman/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export CONTAINERS_MACHINE_PROVIDER=libkrun
pain_require_runtime() {
  [ "$(uname -s):$(uname -m)" = Darwin:arm64 ] || { echo 'Requires an Apple Silicon Mac.' >&2; return 1; }
  command -v podman >/dev/null || { echo 'Install the official Podman macOS package first.' >&2; return 1; }
  [ -x "$pain_runtime/bin/krunkit" ] || { echo 'Install the PAIN runtime artifact with integrations/macos/install-runtime first.' >&2; return 1; }
  cmp -s "$pain_runtime/llama-revision" "$root/containers/virtgpu/llama-revision" || {
    echo 'Runtime and checkout versions differ; install the runtime artifact from this branch build.' >&2; return 1;
  }
  cmp -s "$pain_runtime/virgl-revision" "$root/integrations/macos/virgl-revision" || {
    echo 'APIR runtime revision differs from this checkout.' >&2; return 1;
  }
  case "$pain_data" in *"'"*|*'
'*) echo 'PAIN_DATA_DIR cannot contain a quote or newline.' >&2; return 1 ;; esac
  mkdir -p "$pain_data"
  # The first path selects our private krunkit wrapper; remaining paths locate
  # the networking helpers from either the official Podman package or Homebrew.
  printf "[engine]\nhelper_binaries_dir = ['%s/bin', '/opt/podman/bin', '/opt/podman/libexec', '/opt/homebrew/bin', '/opt/homebrew/libexec/podman', '/opt/homebrew/opt/podman/libexec', '/usr/local/bin', '/usr/local/libexec/podman']\n" "$pain_runtime" > "$pain_data/containers.conf"
  export CONTAINERS_CONF_OVERRIDE="$pain_data/containers.conf"
}
