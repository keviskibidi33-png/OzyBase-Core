package api

import (
	"testing"

	"github.com/dop251/goja"
)

func TestWrapFunctionScriptAllowsTopLevelReturn(t *testing.T) {
	vm := goja.New()

	value, err := vm.RunString(wrapFunctionScript(`return { ok: true, marker: "qa" };`))
	if err != nil {
		t.Fatalf("expected wrapped script to execute, got error: %v", err)
	}

	exported, ok := value.Export().(map[string]any)
	if !ok {
		t.Fatalf("expected object export, got %T", value.Export())
	}

	if exported["marker"] != "qa" {
		t.Fatalf("expected marker qa, got %#v", exported["marker"])
	}
}
