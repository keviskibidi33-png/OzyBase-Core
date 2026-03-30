package api

import "strings"

const (
	workspaceRoleOwner  = "owner"
	workspaceRoleAdmin  = "admin"
	workspaceRoleMember = "member"
	workspaceRoleViewer = "viewer"
)

func normalizeWorkspaceRole(role string) string {
	normalized := strings.ToLower(strings.TrimSpace(role))
	if normalized == "" {
		return workspaceRoleMember
	}
	return normalized
}

func isKnownWorkspaceRole(role string) bool {
	switch normalizeWorkspaceRole(role) {
	case workspaceRoleOwner, workspaceRoleAdmin, workspaceRoleMember, workspaceRoleViewer:
		return true
	default:
		return false
	}
}

func isManagedWorkspaceRole(role string) bool {
	switch normalizeWorkspaceRole(role) {
	case workspaceRoleAdmin, workspaceRoleMember, workspaceRoleViewer:
		return true
	default:
		return false
	}
}

func canViewWorkspaceMembers(role string) bool {
	return isKnownWorkspaceRole(role)
}

func canManageWorkspaceSettings(role string) bool {
	switch normalizeWorkspaceRole(role) {
	case workspaceRoleOwner, workspaceRoleAdmin:
		return true
	default:
		return false
	}
}

func canDeleteWorkspace(role string) bool {
	return normalizeWorkspaceRole(role) == workspaceRoleOwner
}

func canAssignWorkspaceRole(actorRole, desiredRole string) bool {
	switch normalizeWorkspaceRole(actorRole) {
	case workspaceRoleOwner:
		return isManagedWorkspaceRole(desiredRole)
	case workspaceRoleAdmin:
		switch normalizeWorkspaceRole(desiredRole) {
		case workspaceRoleMember, workspaceRoleViewer:
			return true
		default:
			return false
		}
	default:
		return false
	}
}

func canManageWorkspaceMember(actorRole, targetRole string) bool {
	switch normalizeWorkspaceRole(actorRole) {
	case workspaceRoleOwner:
		return normalizeWorkspaceRole(targetRole) != workspaceRoleOwner
	case workspaceRoleAdmin:
		switch normalizeWorkspaceRole(targetRole) {
		case "", workspaceRoleMember, workspaceRoleViewer:
			return true
		default:
			return false
		}
	default:
		return false
	}
}
