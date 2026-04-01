package api

import "testing"

func TestGeoBreachReviewKeyRoundTrip(t *testing.T) {
	reviewKey := buildGeoBreachReviewKey("179.6.171.61", "Peru", "Lima")

	ip, country, city, ok := parseGeoBreachReviewKey(reviewKey)
	if !ok {
		t.Fatalf("expected review key to parse")
	}
	if ip != "179.6.171.61" || country != "Peru" || city != "Lima" {
		t.Fatalf("unexpected review key values: %q %q %q", ip, country, city)
	}
}

func TestBuildSecurityAlertHealthIssueGeoBreach(t *testing.T) {
	issue, aggregateKey, ok := buildSecurityAlertHealthIssue("geo_breach", map[string]any{
		"ip":      "179.6.171.61",
		"country": "Peru",
		"city":    "Lima",
	})
	if !ok {
		t.Fatalf("expected geo breach issue to be included")
	}
	if aggregateKey == "" {
		t.Fatalf("expected aggregate key")
	}
	if issue.Title != "Geographic Access Breach" {
		t.Fatalf("unexpected title %q", issue.Title)
	}
	if !issue.Fixable {
		t.Fatalf("expected geo breach issue to expose auto-fix")
	}
	if !issue.Reviewable {
		t.Fatalf("expected reviewable issue")
	}
	if issue.ActionView != "security_policies" {
		t.Fatalf("unexpected action view %q", issue.ActionView)
	}
	if issue.ActionLabel != "Open Geo-Fencing" {
		t.Fatalf("unexpected action label %q", issue.ActionLabel)
	}
}

func TestNormalizeAllowedCountriesCanonicalizesIsoCodes(t *testing.T) {
	allowed := normalizeAllowedCountries([]any{"PE", "Peru", " CL ", "", nil, "Chile"})

	if len(allowed) != 2 {
		t.Fatalf("expected 2 canonical countries, got %d: %#v", len(allowed), allowed)
	}
	if allowed[0] != "Peru" {
		t.Fatalf("expected first country to normalize to Peru, got %q", allowed[0])
	}
	if allowed[1] != "Chile" {
		t.Fatalf("expected second country to normalize to Chile, got %q", allowed[1])
	}
}
