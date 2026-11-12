# PAIN development

Keep the Mac and Omarchy panel definitions shared through Zen's Omarchy kit.
Platform adapters supply data and execute actions; model file management lives
in `ai`. Native Linux telemetry must not be presented as Mac hardware telemetry.

## Build and compile checks

- `npm --prefix desktop run build`: after frontend/shared panel changes; includes
  TypeScript compilation and a production Vite build.
- `cargo check --manifest-path desktop/src-tauri/Cargo.toml`: after Rust changes;
  stage desktop resources first if this is a fresh checkout.
- `npm --prefix desktop run stage`: before a Mac app build; requires the runtime
  tarball and checksum in `.build`.
- `bash -n integrations/macos/rebuild-install`: after installer changes.
- `./integrations/macos/rebuild-install`: build and install the current Mac app
  for explicitly requested local QA. This replaces the installed app and quits
  its UI, while keeping inference running.

## Existing targeted tests

Run a relevant target once when a test pass is requested. Do not run the whole
suite locally or add tests without an agreed contract and a separate test step.

- `python3 -m unittest discover -s tests -p test_pull.py -v`: model downloading
  and preset registration.
- `python3 -m unittest discover -s tests -p test_desktop.py -v`: desktop adapter
  commands and status formatting.
- `python3 -m unittest discover -s tests -p test_macos_packaging.py -v`: packaged
  Mac controller and runtime paths.
- `npm --prefix desktop run test:stories -- --no-browser`: existing UI story
  plays using the virtual DOM.

After changes between test passes, use build and compile checks. CI is the final
check; do not start parallel builds against the same Cargo target directory.
