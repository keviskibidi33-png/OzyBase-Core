package api

import (
	"context"
	"strings"
	"testing"
)

func TestNormalizeRLSPolicies_FallbackFromLegacyRule(t *testing.T) {
	policies := normalizeRLSPolicies("user_id = auth.uid()", nil)

	if policies["select"] != "user_id = auth.uid()" {
		t.Fatalf("expected select fallback from legacy rule")
	}
	if policies["insert"] != "user_id = auth.uid()" {
		t.Fatalf("expected insert fallback from legacy rule")
	}
	if policies["update"] != "user_id = auth.uid()" {
		t.Fatalf("expected update fallback from legacy rule")
	}
	if policies["delete"] != "user_id = auth.uid()" {
		t.Fatalf("expected delete fallback from legacy rule")
	}
}

func TestNormalizeRLSPolicies_PerActionOverridesLegacy(t *testing.T) {
	policies := normalizeRLSPolicies("true", map[string]string{
		"select": "false",
		"delete": "user_id = auth.uid()",
	})

	if policies["select"] != "false" {
		t.Fatalf("expected select policy to keep explicit value")
	}
	if policies["insert"] != "true" {
		t.Fatalf("expected insert to fallback to legacy rule")
	}
	if policies["update"] != "true" {
		t.Fatalf("expected update to fallback to legacy rule")
	}
	if policies["delete"] != "user_id = auth.uid()" {
		t.Fatalf("expected delete policy to keep explicit value")
	}
}

func TestValidateRLSPolicyActions(t *testing.T) {
	if err := validateRLSPolicyActions(map[string]string{
		"select": "true",
		"update": "true",
	}); err != nil {
		t.Fatalf("expected valid actions, got %v", err)
	}

	if err := validateRLSPolicyActions(map[string]string{
		"merge": "true",
	}); err == nil {
		t.Fatalf("expected invalid action error")
	}
}

func TestValidateRLSExpression_StaticValidation(t *testing.T) {
	tests := []struct {
		name       string
		expression string
		wantErr    bool
	}{
		{name: "empty expression", expression: "", wantErr: true},
		{name: "semicolon blocked", expression: "true; DROP TABLE users", wantErr: true},
		{name: "line comment blocked", expression: "true -- comment", wantErr: true},
		{name: "block comment blocked", expression: "true /* comment */", wantErr: true},
		{name: "pg_sleep blocked", expression: "pg_sleep(10) IS NULL", wantErr: true},
		{name: "set_config blocked", expression: "set_config('x','y',true) IS NOT NULL", wantErr: true},
		{name: "too long expression", expression: strings.Repeat("a", 1025), wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateRLSExpression(context.Background(), nil, "users", tt.expression)
			if tt.wantErr && err == nil {
				t.Fatalf("expected validation error")
			}
			if !tt.wantErr && err != nil {
				t.Fatalf("did not expect error, got %v", err)
			}
		})
	}
}

func TestMakePolicyName(t *testing.T) {
	name := makePolicyName("users", "select")
	if name != "policy_ozy_users_select" {
		t.Fatalf("unexpected policy name: %s", name)
	}

	longTable := strings.Repeat("a", 90)
	longName := makePolicyName(longTable, "delete")
	if len(longName) > 63 {
		t.Fatalf("policy name should be <= 63 chars, got %d", len(longName))
	}
	if !strings.HasPrefix(longName, "policy_ozy_") {
		t.Fatalf("expected policy name prefix")
	}
	if !strings.HasSuffix(longName, "_delete") {
		t.Fatalf("expected policy name suffix with action")
	}
}
