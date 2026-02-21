package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

func main() {
	dbURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if dbURL == "" {
		log.Fatal("DATABASE_URL is required")
	}
	ctx := context.Background()

	db, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		log.Fatalf("Unable to connect to database: %v", err)
	}
	defer db.Close()

	email := strings.TrimSpace(os.Getenv("RESET_ADMIN_EMAIL"))
	if email == "" {
		email = "system@ozybase.local"
	}
	newPassword := strings.TrimSpace(os.Getenv("RESET_ADMIN_PASSWORD"))
	if newPassword == "" {
		log.Fatal("RESET_ADMIN_PASSWORD is required")
	}

	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(newPassword), 12)
	if err != nil {
		log.Fatalf("Error hashing password: %v", err)
	}

	// Update or Insert admin user
	// Check if admin exists
	var count int
	err = db.QueryRow(ctx, "SELECT COUNT(*) FROM _v_users WHERE email = $1", email).Scan(&count)
	if err != nil {
		log.Fatalf("Error checking user: %v", err)
	}

	if count > 0 {
		_, err = db.Exec(ctx, "UPDATE _v_users SET password_hash = $1 WHERE email = $2", string(hashedPassword), email)
		if err != nil {
			log.Fatalf("Error updating password: %v", err)
		}
		fmt.Printf("✅ Updated password for %s\n", email)
	} else {
		_, err = db.Exec(ctx, "INSERT INTO _v_users (email, password_hash, role) VALUES ($1, $2, 'admin')", email, string(hashedPassword))
		if err != nil {
			log.Fatalf("Error creating user: %v", err)
		}
		fmt.Printf("✅ Created admin user %s\n", email)
	}
}
