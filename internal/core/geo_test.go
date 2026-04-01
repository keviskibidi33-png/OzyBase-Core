package core

import (
	"context"
	"testing"
)

func TestGeoCountryMatches(t *testing.T) {
	tests := []struct {
		name    string
		allowed string
		actual  string
		want    bool
	}{
		{name: "exact country name", allowed: "Peru", actual: "Peru", want: true},
		{name: "case insensitive country name", allowed: "peru", actual: "Peru", want: true},
		{name: "iso code matches full name", allowed: "PE", actual: "Peru", want: true},
		{name: "iso code matches case insensitive full name", allowed: "pe", actual: "peru", want: true},
		{name: "different countries do not match", allowed: "PE", actual: "Chile", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := geoCountryMatches(tt.allowed, tt.actual); got != tt.want {
				t.Fatalf("geoCountryMatches(%q, %q) = %v, want %v", tt.allowed, tt.actual, got, tt.want)
			}
		})
	}
}

func TestCheckBreachAcceptsIsoConfiguredCountry(t *testing.T) {
	service := &GeoService{
		policyCache: &GeoPolicy{
			Enabled:          true,
			AllowedCountries: []string{"PE"},
		},
	}

	isBreach, err := service.CheckBreach(context.Background(), "179.6.171.61", "Peru")
	if err != nil {
		t.Fatalf("CheckBreach returned error: %v", err)
	}
	if isBreach {
		t.Fatalf("expected Peru to be allowed when policy contains PE")
	}
}
