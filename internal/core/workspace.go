package core

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"github.com/Xangel0s/OzyBase/internal/data"
)

type WorkspaceService struct {
	db *data.DB
}

func NewWorkspaceService(db *data.DB) *WorkspaceService {
	return &WorkspaceService{db: db}
}

// CreateWorkspace creates a new isolated environment and assigns an owner
func (s *WorkspaceService) CreateWorkspace(ctx context.Context, name, ownerID string) (*Workspace, error) {
	slug := s.GenerateSlug(name)

	tx, err := s.db.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var ws Workspace
	err = tx.QueryRow(ctx, `
		INSERT INTO _v_workspaces (name, slug)
		VALUES ($1, $2)
		RETURNING id, name, slug, config, created_at, updated_at
	`, name, slug).Scan(&ws.ID, &ws.Name, &ws.Slug, &ws.Config, &ws.CreatedAt, &ws.UpdatedAt)

	if err != nil {
		return nil, fmt.Errorf("failed to create workspace: %w", err)
	}

	// Add owner
	_, err = tx.Exec(ctx, `
		INSERT INTO _v_workspace_members (workspace_id, user_id, role)
		VALUES ($1, $2, $3)
	`, ws.ID, ownerID, "owner")

	if err != nil {
		return nil, fmt.Errorf("failed to add workspace owner: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return &ws, nil
}

// ListWorkspacesForUser returns all workspaces where the user is a member
func (s *WorkspaceService) ListWorkspacesForUser(ctx context.Context, userID string) ([]Workspace, error) {
	rows, err := s.db.Pool.Query(ctx, `
		SELECT w.id, w.name, w.slug, w.config, w.created_at, w.updated_at
		FROM _v_workspaces w
		JOIN _v_workspace_members m ON w.id = m.workspace_id
		WHERE m.user_id = $1
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var workspaces []Workspace
	for rows.Next() {
		var ws Workspace
		if err := rows.Scan(&ws.ID, &ws.Name, &ws.Slug, &ws.Config, &ws.CreatedAt, &ws.UpdatedAt); err != nil {
			return nil, err
		}
		workspaces = append(workspaces, ws)
	}
	return workspaces, nil
}

// GenerateSlug creates a URL-friendly version of the name
func (s *WorkspaceService) GenerateSlug(name string) string {
	reg := regexp.MustCompile("[^a-z0-9]+")
	slug := strings.ToLower(name)
	slug = reg.ReplaceAllString(slug, "-")
	slug = strings.Trim(slug, "-")
	return slug
}

// IsMember checks if a user belongs to a workspace
func (s *WorkspaceService) IsMember(ctx context.Context, workspaceID, userID string) (bool, string, error) {
	var role string
	err := s.db.Pool.QueryRow(ctx, `
		SELECT role FROM _v_workspace_members
		WHERE workspace_id = $1 AND user_id = $2
	`, workspaceID, userID).Scan(&role)

	if err != nil {
		return false, "", nil
	}
	return true, role, nil
}
