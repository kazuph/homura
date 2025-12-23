# Makefile for building mruby to WASI/WebAssembly
#
# Prerequisites:
# 1. Install wasi-sdk: brew install --cask aspect-build/aspect/wasi-sdk
#    Or download from: https://github.com/aspect-build/aspect-build-wasi-sdk/releases
# 2. Set WASI_SDK_PATH if not at /opt/wasi-sdk
#
# Usage:
#   make          - Build mruby.wasm
#   make clean    - Clean build artifacts
#   make setup    - Clone mruby source

WASI_SDK_PATH ?= $(HOME)/.local/wasi-sdk
MRUBY_VERSION ?= 3.3.0
MRUBY_SRC_DIR = mruby-src
BUILD_DIR = build
MRUBY_BUILD_DIR = $(MRUBY_SRC_DIR)/build/wasm32-wasi
MRUBY_LIB = $(MRUBY_BUILD_DIR)/lib/libmruby.a
MRUBY_INCLUDE = -I$(MRUBY_SRC_DIR)/include -I$(MRUBY_BUILD_DIR)/include
HOMURA_ENTRY = src/homura_entry.c
WASI_CC = $(WASI_SDK_PATH)/bin/clang
CFLAGS = -O2 --target=wasm32-wasi -fno-exceptions -D_WASI_EMULATED_SIGNAL -DMRB_NO_STDIO -mllvm -wasm-enable-sjlj
LDFLAGS = -Wl,--export-all -Wl,--no-entry -Wl,--allow-undefined -nostartfiles

.PHONY: all clean setup check-wasi-sdk

all: check-wasi-sdk $(BUILD_DIR)/mruby.wasm

check-wasi-sdk:
	@if [ ! -d "$(WASI_SDK_PATH)" ]; then \
		echo "Error: wasi-sdk not found at $(WASI_SDK_PATH)"; \
		echo "Install with: brew install --cask aspect-build/aspect/wasi-sdk"; \
		echo "Or set WASI_SDK_PATH to your installation"; \
		exit 1; \
	fi

setup:
	@if [ ! -d "$(MRUBY_SRC_DIR)" ]; then \
		echo "Cloning mruby $(MRUBY_VERSION)..."; \
		git clone --depth 1 --branch $(MRUBY_VERSION) https://github.com/mruby/mruby.git $(MRUBY_SRC_DIR); \
	else \
		echo "mruby source already exists"; \
	fi

$(BUILD_DIR)/mruby.wasm: setup
	@echo "Building mruby for WASI..."
	@mkdir -p $(BUILD_DIR)
	cd $(MRUBY_SRC_DIR) && \
		WASI_SDK_PATH=$(WASI_SDK_PATH) \
		MRUBY_CONFIG=../build_config.rb \
		rake
	@echo "Linking homura_entry with libmruby..."
	$(WASI_CC) $(CFLAGS) $(MRUBY_INCLUDE) $(HOMURA_ENTRY) $(MRUBY_LIB) $(LDFLAGS) -o $(BUILD_DIR)/mruby.wasm
	@echo "Build complete: $(BUILD_DIR)/mruby.wasm"

clean:
	rm -rf $(BUILD_DIR)
	cd $(MRUBY_SRC_DIR) 2>/dev/null && rake clean || true

# Alternative: Use pre-built mruby.wasm from elct9620/mruby.wasm
fetch-prebuilt:
	@echo "Fetching pre-built mruby.wasm..."
	@mkdir -p $(BUILD_DIR)
	curl -L -o $(BUILD_DIR)/mruby.wasm \
		https://github.com/aspect-build/aspect-build-wasi-sdk/releases/download/wasi-sdk-24/mruby.wasm || \
		echo "Pre-built wasm not available, please build manually"
