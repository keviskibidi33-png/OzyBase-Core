package api

import "testing"

func TestNormalizeWorkspaceRole(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "defaults empty to member", input: "", want: workspaceRoleMember},
		{name: "trims and lowers", input: "  AdMiN ", want: workspaceRoleAdmin},
		{name: "keeps owner", input: "owner", want: workspaceRoleOwner},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			if got := normalizeWorkspaceRole(tt.input); got != tt.want {
				t.Fatalf("normalizeWorkspaceRole(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestCanAssignWorkspaceRole(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		actorRole  string
		targetRole string
		want       bool
	}{
		{name: "owner can assign admin", actorRole: workspaceRoleOwner, targetRole: workspaceRoleAdmin, want: true},
		{name: "owner can assign viewer", actorRole: workspaceRoleOwner, targetRole: workspaceRoleViewer, want: true},
		{name: "owner cannot assign owner", actorRole: workspaceRoleOwner, targetRole: workspaceRoleOwner, want: false},
		{name: "admin can assign member", actorRole: workspaceRoleAdmin, targetRole: workspaceRoleMember, want: true},
		{name: "admin cannot assign admin", actorRole: workspaceRoleAdmin, targetRole: workspaceRoleAdmin, want: false},
		{name: "member cannot assign viewer", actorRole: workspaceRoleMember, targetRole: workspaceRoleViewer, want: false},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			if got := canAssignWorkspaceRole(tt.actorRole, tt.targetRole); got != tt.want {
				t.Fatalf("canAssignWorkspaceRole(%q, %q) = %t, want %t", tt.actorRole, tt.targetRole, got, tt.want)
			}
		})
	}
}

func TestCanManageWorkspaceMember(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		actorRole  string
		targetRole string
		want       bool
	}{
		{name: "owner can manage admin", actorRole: workspaceRoleOwner, targetRole: workspaceRoleAdmin, want: true},
		{name: "owner cannot manage owner", actorRole: workspaceRoleOwner, targetRole: workspaceRoleOwner, want: false},
		{name: "admin can manage member", actorRole: workspaceRoleAdmin, targetRole: workspaceRoleMember, want: true},
		{name: "admin can manage new invite", actorRole: workspaceRoleAdmin, targetRole: "", want: true},
		{name: "admin cannot manage admin", actorRole: workspaceRoleAdmin, targetRole: workspaceRoleAdmin, want: false},
		{name: "viewer cannot manage member", actorRole: workspaceRoleViewer, targetRole: workspaceRoleMember, want: false},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			if got := canManageWorkspaceMember(tt.actorRole, tt.targetRole); got != tt.want {
				t.Fatalf("canManageWorkspaceMember(%q, %q) = %t, want %t", tt.actorRole, tt.targetRole, got, tt.want)
			}
		})
	}
}
