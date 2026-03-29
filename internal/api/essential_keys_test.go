package api

import (
	"testing"
	"time"
)

func TestEncryptDecryptKeyMaterial(t *testing.T) {
	secret := "unit-test-secret-32-characters-minimum"
	plaintext := "ozys_deadbeef_abcdef1234567890"

	ciphertext, err := encryptKeyMaterial(secret, plaintext)
	if err != nil {
		t.Fatalf("encryptKeyMaterial returned error: %v", err)
	}
	if ciphertext == "" {
		t.Fatalf("expected ciphertext")
	}

	restored, err := decryptKeyMaterial(secret, ciphertext)
	if err != nil {
		t.Fatalf("decryptKeyMaterial returned error: %v", err)
	}
	if restored != plaintext {
		t.Fatalf("decryptKeyMaterial() = %q, want %q", restored, plaintext)
	}
}

func TestAdminVerificationTokenRoundTrip(t *testing.T) {
	now := time.Date(2026, time.March, 28, 18, 30, 0, 0, time.UTC)
	token, expiresAt, err := issueAdminVerificationToken("jwt-secret", "11111111-1111-1111-1111-111111111111", adminVerifyScopeEssential, now, 10*time.Minute)
	if err != nil {
		t.Fatalf("issueAdminVerificationToken returned error: %v", err)
	}
	if expiresAt.Sub(now) != 10*time.Minute {
		t.Fatalf("unexpected expiry delta: %v", expiresAt.Sub(now))
	}

	if err := validateAdminVerificationToken("jwt-secret", token, "11111111-1111-1111-1111-111111111111", adminVerifyScopeEssential, now.Add(5*time.Minute)); err != nil {
		t.Fatalf("validateAdminVerificationToken returned error: %v", err)
	}
}

func TestAdminVerificationTokenRejectsWrongScopeOrExpiry(t *testing.T) {
	now := time.Date(2026, time.March, 28, 18, 30, 0, 0, time.UTC)
	token, _, err := issueAdminVerificationToken("jwt-secret", "11111111-1111-1111-1111-111111111111", adminVerifyScopeEssential, now, time.Minute)
	if err != nil {
		t.Fatalf("issueAdminVerificationToken returned error: %v", err)
	}

	if err := validateAdminVerificationToken("jwt-secret", token, "11111111-1111-1111-1111-111111111111", "other_scope", now.Add(30*time.Second)); err == nil {
		t.Fatalf("expected scope validation error")
	}
	if err := validateAdminVerificationToken("jwt-secret", token, "11111111-1111-1111-1111-111111111111", adminVerifyScopeEssential, now.Add(2*time.Minute)); err == nil {
		t.Fatalf("expected expiry validation error")
	}
}

func TestGenerateManagedAPIKey(t *testing.T) {
	key, prefix, err := generateManagedAPIKey(APIKeyRoleServiceRole)
	if err != nil {
		t.Fatalf("generateManagedAPIKey returned error: %v", err)
	}
	if prefix == "" || key == "" {
		t.Fatalf("expected key and prefix")
	}
	if len(prefix) > 10 {
		t.Fatalf("prefix should fit schema column, got %q", prefix)
	}
	if len(key) <= len(prefix) {
		t.Fatalf("expected key to contain secret material after prefix")
	}
}
