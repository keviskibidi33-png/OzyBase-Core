package mailer

import "testing"

func TestSMTPAuthForConfigRequiresCredentials(t *testing.T) {
	if got := smtpAuthForConfig("127.0.0.1", "", ""); got != nil {
		t.Fatalf("expected nil auth without credentials")
	}
}

func TestSMTPAuthForConfigAcceptsHostPort(t *testing.T) {
	if got := smtpAuthForConfig("smtp.example.com:587", "demo", "secret"); got == nil {
		t.Fatalf("expected smtp auth when host and credentials are present")
	}
}
