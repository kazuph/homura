# mruby build configuration for WASI target
#
# This creates a cross-build for wasm32-wasi using wasi-sdk
# with SJLJ (setjmp/longjmp) enabled for wasm.

WASI_SDK_PATH = ENV['WASI_SDK_PATH'] || "#{ENV['HOME']}/.local/wasi-sdk"

# Host build (needed for mrbc compiler)
MRuby::Build.new do |conf|
  conf.toolchain :clang

  # Minimal gems for host (just need mrbc)
  conf.gem :core => 'mruby-bin-mrbc'
end

# WASI cross build (SJLJ)
MRuby::CrossBuild.new('wasm32-wasi') do |conf|
  conf.disable_cxx_exception

  conf.cc do |cc|
    cc.command = "#{WASI_SDK_PATH}/bin/clang"
    cc.flags = %w[
      -O2
      --target=wasm32-wasi
      -fno-exceptions
      -D_WASI_EMULATED_SIGNAL
      -DMRB_NO_STDIO
      -mllvm
      -wasm-enable-sjlj
    ]
  end

  conf.cxx do |cxx|
    cxx.command = "#{WASI_SDK_PATH}/bin/clang++"
    cxx.flags = %w[
      -O2
      --target=wasm32-wasi
      -fno-exceptions
      -D_WASI_EMULATED_SIGNAL
    ]
  end

  conf.linker do |linker|
    linker.command = "#{WASI_SDK_PATH}/bin/clang"
    linker.flags = %w[
      --target=wasm32-wasi
      -Wl,--export-all
      -Wl,--no-entry
      -nostartfiles
    ]
  end

  conf.archiver do |archiver|
    archiver.command = "#{WASI_SDK_PATH}/bin/llvm-ar"
  end

  # Minimal gems for edge computing (no stdio)
  conf.gem :core => 'mruby-sprintf'
  conf.gem :core => 'mruby-math'
  conf.gem :core => 'mruby-struct'
  conf.gem :core => 'mruby-enum-ext'
  conf.gem :core => 'mruby-string-ext'
  conf.gem :core => 'mruby-array-ext'
  conf.gem :core => 'mruby-hash-ext'
  conf.gem :core => 'mruby-range-ext'
  conf.gem :core => 'mruby-proc-ext'
  conf.gem :core => 'mruby-symbol-ext'
  conf.gem :core => 'mruby-object-ext'
  conf.gem :core => 'mruby-kernel-ext'
  conf.gem :core => 'mruby-class-ext'
  conf.gem :core => 'mruby-method'
  conf.gem :core => 'mruby-compiler'
end
