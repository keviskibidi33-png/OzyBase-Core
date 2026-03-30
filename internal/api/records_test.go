package api

import "testing"

func TestApplyOwnerFieldDefaultAddsMissingOwner(t *testing.T) {
	input := map[string]any{"title": "Invoice"}
	got := applyOwnerFieldDefault(input, "user_id", "owner-123")

	if got["user_id"] != "owner-123" {
		t.Fatalf("expected injected owner_id, got %#v", got["user_id"])
	}
	if got["title"] != "Invoice" {
		t.Fatalf("expected title to be preserved, got %#v", got["title"])
	}
}

func TestApplyOwnerFieldDefaultPreservesExistingOwner(t *testing.T) {
	input := map[string]any{"user_id": "custom-owner"}
	got := applyOwnerFieldDefault(input, "user_id", "owner-123")

	if got["user_id"] != "custom-owner" {
		t.Fatalf("expected existing owner to remain, got %#v", got["user_id"])
	}
}

func TestApplyOwnerFieldDefaultReplacesBlankOwner(t *testing.T) {
	input := map[string]any{"user_id": "   "}
	got := applyOwnerFieldDefault(input, "user_id", "owner-123")

	if got["user_id"] != "owner-123" {
		t.Fatalf("expected blank owner to be replaced, got %#v", got["user_id"])
	}
}
