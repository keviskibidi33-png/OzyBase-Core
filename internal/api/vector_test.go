package api

import (
	"math"
	"testing"
)

func TestNormalizeVectorMetric(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		metric  string
		opClass string
		wantErr bool
	}{
		{name: "default", input: "", metric: "cosine", opClass: "vector_cosine_ops"},
		{name: "cosine", input: "cosine", metric: "cosine", opClass: "vector_cosine_ops"},
		{name: "l2", input: "l2", metric: "l2", opClass: "vector_l2_ops"},
		{name: "euclidean alias", input: "euclidean", metric: "l2", opClass: "vector_l2_ops"},
		{name: "ip", input: "ip", metric: "ip", opClass: "vector_ip_ops"},
		{name: "invalid", input: "manhattan", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			metric, opClass, err := normalizeVectorMetric(tt.input)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got metric=%q opClass=%q", metric, opClass)
				}
				return
			}
			if err != nil {
				t.Fatalf("expected no error, got %v", err)
			}
			if metric != tt.metric {
				t.Fatalf("metric mismatch: got=%q want=%q", metric, tt.metric)
			}
			if opClass != tt.opClass {
				t.Fatalf("opClass mismatch: got=%q want=%q", opClass, tt.opClass)
			}
		})
	}
}

func TestVectorLiteral(t *testing.T) {
	got, err := vectorLiteral([]float64{0.1, -2, 3.14159})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if got != "[0.1,-2,3.14159]" {
		t.Fatalf("unexpected literal: %q", got)
	}

	if _, err := vectorLiteral([]float64{}); err == nil {
		t.Fatalf("expected error for empty embedding")
	}
	if _, err := vectorLiteral([]float64{math.NaN()}); err == nil {
		t.Fatalf("expected error for NaN embedding")
	}
	if _, err := vectorLiteral([]float64{math.Inf(1)}); err == nil {
		t.Fatalf("expected error for Inf embedding")
	}
}

func TestParseVectorTypeDimension(t *testing.T) {
	dim, err := parseVectorTypeDimension("vector(1536)")
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if dim != 1536 {
		t.Fatalf("dimension mismatch: got=%d want=%d", dim, 1536)
	}

	if _, err := parseVectorTypeDimension("text"); err == nil {
		t.Fatalf("expected error for non-vector format")
	}
	if _, err := parseVectorTypeDimension("vector(x)"); err == nil {
		t.Fatalf("expected error for non-integer dimension")
	}
}
