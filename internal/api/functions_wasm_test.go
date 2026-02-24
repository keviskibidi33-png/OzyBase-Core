package api

import "testing"

func TestNormalizeFunctionRuntime(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    string
		wantErr bool
	}{
		{name: "default", input: "", want: "js"},
		{name: "js", input: "js", want: "js"},
		{name: "wasm uppercase", input: "WASM", want: "wasm"},
		{name: "invalid", input: "python", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := normalizeFunctionRuntime(tt.input)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error for runtime %q", tt.input)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Fatalf("runtime mismatch: got=%q want=%q", got, tt.want)
			}
		})
	}
}

func TestNormalizeFunctionTimeout(t *testing.T) {
	if got := normalizeFunctionTimeout(0); got != defaultFunctionTimeoutMS {
		t.Fatalf("default timeout mismatch: got=%d want=%d", got, defaultFunctionTimeoutMS)
	}
	if got := normalizeFunctionTimeout(1); got != minFunctionTimeoutMS {
		t.Fatalf("min timeout clamp mismatch: got=%d want=%d", got, minFunctionTimeoutMS)
	}
	if got := normalizeFunctionTimeout(120000); got != maxFunctionTimeoutMS {
		t.Fatalf("max timeout clamp mismatch: got=%d want=%d", got, maxFunctionTimeoutMS)
	}
}

func TestDecodeWASMModuleBase64(t *testing.T) {
	module, err := decodeWASMModuleBase64("AGFzbQEAAAA=")
	if err != nil {
		t.Fatalf("expected valid minimal wasm module, got error: %v", err)
	}
	if len(module) == 0 {
		t.Fatalf("expected decoded bytes")
	}

	if _, err := decodeWASMModuleBase64(""); err == nil {
		t.Fatalf("expected error for empty payload")
	}
	if _, err := decodeWASMModuleBase64("not-base64"); err == nil {
		t.Fatalf("expected error for invalid base64 payload")
	}
}
