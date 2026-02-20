package auth

import (
	"context"
	"crypto/rand"
	"fmt"
	"log"
	"math/big"
	"os"
	"strings"

	"github.com/Xangel0s/OzyBase/internal/data"
	"golang.org/x/crypto/bcrypt"
)

const (
	passwordChars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*"
)

func generateRandomPassword(length int) string {
	result := make([]byte, length)
	for i := range result {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(passwordChars))))
		result[i] = passwordChars[n.Int64()]
	}
	return string(result)
}

func EnsureAdminUser(db *data.DB) {
	ctx := context.Background()

	var count int
	err := db.Pool.QueryRow(ctx, "SELECT COUNT(*) FROM _v_users WHERE role = 'admin'").Scan(&count)
	if err != nil {
		log.Printf("⚠️ Error checking for admin user: %v", err)
		return
	}

	if count > 0 {
		return
	}

	email := os.Getenv("INITIAL_ADMIN_EMAIL")
	if email == "" {
		appDomain := strings.TrimSpace(os.Getenv("APP_DOMAIN"))
		if appDomain == "" || appDomain == "localhost" || strings.HasPrefix(appDomain, "localhost:") {
			email = "system@ozybase.local"
		} else {
			email = "admin@" + appDomain
		}
	}

	password := os.Getenv("INITIAL_ADMIN_PASSWORD")
	isGenerated := false
	if password == "" {
		password = generateRandomPassword(32)
		isGenerated = true
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		log.Printf("⚠️ Error hashing admin password: %v", err)
		return
	}

	_, err = db.Pool.Exec(ctx, `
		INSERT INTO _v_users (email, password_hash, role)
		VALUES ($1, $2, $3)
	`, email, string(hashedPassword), "admin")

	if err != nil {
		log.Printf("⚠️ Error creating initial admin user: %v", err)
		return
	}

	fmt.Println("\n*************************************************")
	fmt.Println("*  OZYBASE INITIAL ADMIN CREDENTIALS            *")
	fmt.Printf("*  Email: %-37s *\n", email)
	if isGenerated {
		fmt.Printf("*  Password: %-34s *\n", password)
		fmt.Println("*  (One-time use log: Save it now!)             *")
	} else {
		fmt.Println("*  Password: [FROM ENVIRONMENT VARIABLE]        *")
	}
	fmt.Println("*  Please change this after your first login!   *")
	fmt.Println("*************************************************")
}
