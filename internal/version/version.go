package version

import "fmt"

var (
	// Version is set at build time by goreleaser.
	Version = "dev"
	// Commit is set at build time by goreleaser.
	Commit = "none"
	// Date is set at build time by goreleaser.
	Date = "unknown"
	// BuiltBy is set at build time by goreleaser.
	BuiltBy = "local"
)

// String returns a single-line user-friendly version string.
func String() string {
	return fmt.Sprintf("ozybase %s (commit: %s, built: %s, by: %s)", Version, Commit, Date, BuiltBy)
}
