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
	if !issue.Reviewable {
		t.Fatalf("expected reviewable issue")
	}
	if issue.Fixable {
		t.Fatalf("expected geo breach to stay review-only")
	}
	if issue.ActionView != "security_policies" {
		t.Fatalf("unexpected action view %q", issue.ActionView)
	}
	if issue.ActionLabel != "Open Geo-Fencing" {
		t.Fatalf("unexpected action label %q", issue.ActionLabel)
	}
}
