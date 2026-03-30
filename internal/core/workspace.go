package core

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/Xangel0s/OzyBase/internal/data"
	"github.com/jackc/pgx/v5"
)

type WorkspaceService struct {
	db *data.DB
}

func NewWorkspaceService(db *data.DB) *WorkspaceService {
	return &WorkspaceService{db: db}
}

func (s *WorkspaceService) GetDB() *data.DB {
	return s.db
}

// CreateWorkspace creates a new isolated environment and assigns an owner
func (s *WorkspaceService) CreateWorkspace(ctx context.Context, name, ownerID string) (*Workspace, error) {
	slug := s.GenerateSlug(name)

	tx, err := s.db.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

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

	workspaces := []Workspace{}
	for rows.Next() {
		var ws Workspace
		if err := rows.Scan(&ws.ID, &ws.Name, &ws.Slug, &ws.Config, &ws.CreatedAt, &ws.UpdatedAt); err != nil {
			return nil, err
		}
		workspaces = append(workspaces, ws)
	}
	return workspaces, nil
}

// UpdateWorkspace updates workspace metadata
func (s *WorkspaceService) UpdateWorkspace(ctx context.Context, id, name string, config map[string]interface{}) error {
	_, err := s.db.Pool.Exec(ctx, `
		UPDATE _v_workspaces 
		SET name = $1, config = $2, updated_at = NOW()
		WHERE id = $3
	`, name, config, id)
	return err
}

// DeleteWorkspace removes a workspace and all its members
func (s *WorkspaceService) DeleteWorkspace(ctx context.Context, id string) error {
	_, err := s.db.Pool.Exec(ctx, "DELETE FROM _v_workspaces WHERE id = $1", id)
	return err
}

// GetWorkspaceMembers returns all members of a workspace
func (s *WorkspaceService) GetWorkspaceMembers(ctx context.Context, workspaceID string) ([]map[string]interface{}, error) {
	rows, err := s.db.Pool.Query(ctx, `
		SELECT m.user_id, u.email, m.role, m.joined_at
		FROM _v_workspace_members m
		JOIN _v_users u ON m.user_id = u.id
		WHERE m.workspace_id = $1
	`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var members []map[string]interface{}
	for rows.Next() {
		var userID, email, role string
		var joinedAt interface{}
		if err := rows.Scan(&userID, &email, &role, &joinedAt); err != nil {
			return nil, err
		}
		members = append(members, map[string]interface{}{
			"user_id":   userID,
			"email":     email,
			"role":      role,
			"joined_at": joinedAt,
		})
	}
	return members, nil
}

// AddWorkspaceMember adds or updates a member's role in a workspace
func (s *WorkspaceService) AddWorkspaceMember(ctx context.Context, workspaceID, userID, role string) error {
	_, err := s.db.Pool.Exec(ctx, `
		INSERT INTO _v_workspace_members (workspace_id, user_id, role)
		VALUES ($1, $2, $3)
		ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role
	`, workspaceID, userID, role)
	return err
}

// RemoveWorkspaceMember removes a member from a workspace
func (s *WorkspaceService) RemoveWorkspaceMember(ctx context.Context, workspaceID, userID string) error {
	_, err := s.db.Pool.Exec(ctx, `
		DELETE FROM _v_workspace_members 
		WHERE workspace_id = $1 AND user_id = $2
	`, workspaceID, userID)
	return err
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
		if errors.Is(err, pgx.ErrNoRows) {
			return false, "", nil
		}
		return false, "", fmt.Errorf("lookup workspace membership: %w", err)
	}
	return true, role, nil
}
