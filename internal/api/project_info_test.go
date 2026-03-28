package api

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestProjectInfoDoesNotExposeConnectionSecrets(t *testing.T) {
	info := ProjectInfo{
		Name:     "test",
		Database: "ozybase",
		Version:  "16",
	}

	payload, err := json.Marshal(info)
	if err != nil {
		t.Fatalf("marshal project info: %v", err)
	}

	body := string(payload)
	for _, forbidden := range []string{
		`"host":`,
		`"port":`,
		`"user":`,
		`"password":`,
		`"service_role":`,
		`"service_key":`,
		`"pooler":`,
		`"smtp_pass":`,
	} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("project info payload unexpectedly contains %s", forbidden)
		}
	}
}
