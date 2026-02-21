package data

import (
	"context"
	"testing"
)

func TestCreatePolicyForAction_RejectsInvalidAction(t *testing.T) {
	db := &DB{}

	err := db.CreatePolicyForAction(context.Background(), nil, "users", "policy_users_test", "merge", "true")
	if err == nil {
		t.Fatalf("expected invalid action error")
	}
}

func TestCreatePolicyForAction_RejectsInvalidIdentifiers(t *testing.T) {
	db := &DB{}

	err := db.CreatePolicyForAction(context.Background(), nil, "users;", "policy_users_test", "select", "true")
	if err == nil {
		t.Fatalf("expected invalid identifier error for table name")
	}

	err = db.CreatePolicyForAction(context.Background(), nil, "users", "policy users", "select", "true")
	if err == nil {
		t.Fatalf("expected invalid identifier error for policy name")
	}
}
