package api

import "testing"

func TestIsReleaseNewer(t *testing.T) {
	tests := []struct {
		name    string
		current string
		latest  string
		want    bool
	}{
		{name: "latest patch wins", current: "v1.0.0", latest: "v1.0.1", want: true},
		{name: "same version is current", current: "v1.2.3", latest: "v1.2.3", want: false},
		{name: "older release is ignored", current: "v1.3.0", latest: "v1.2.9", want: false},
		{name: "dev build does not compare", current: "dev", latest: "v1.2.3", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isReleaseNewer(tt.current, tt.latest); got != tt.want {
				t.Fatalf("expected %v, got %v", tt.want, got)
			}
		})
	}
}
