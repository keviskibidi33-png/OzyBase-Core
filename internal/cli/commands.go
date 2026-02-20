package cli

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/Xangel0s/OzyBase/internal/updater"
	"github.com/Xangel0s/OzyBase/internal/version"
)

var functionNameRegex = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

const defaultFunctionTemplate = `(() => {
  const name = body?.name ?? "world";
  console.log("function invoked", { name });

  return {
    ok: true,
    message: "Hello " + name,
    now: new Date().toISOString(),
  };
})();
`

// HandleGlobalCommands processes CLI commands that don't require booting the server or DB.
func HandleGlobalCommands(args []string) (bool, error) {
	if len(args) < 2 {
		return false, nil
	}

	switch args[1] {
	case "version", "--version", "-v":
		fmt.Println(version.String())
		return true, nil
	case "init":
		return true, handleInit(args[2:])
	case "upgrade":
		return true, handleUpgrade(args[2:])
	case "functions":
		return true, handleFunctions(args[2:])
	default:
		return false, nil
	}
}

func handleUpgrade(args []string) error {
	fs := flag.NewFlagSet("upgrade", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)

	repo := fs.String("repo", "", "GitHub repo in owner/name format")
	targetVersion := fs.String("version", "", "Version tag to install (e.g. v1.2.3)")
	if err := fs.Parse(args); err != nil {
		return err
	}

	result, err := updater.Upgrade(updater.Options{
		Repo:    *repo,
		Version: *targetVersion,
	})
	if err != nil {
		return err
	}

	fmt.Println(result)
	if strings.Contains(result, ".new.exe") {
		fmt.Println("windows note: replace the current executable with the new file after closing running instances.")
	}
	return nil
}

func handleFunctions(args []string) error {
	if len(args) == 0 {
		return errors.New("usage: ozybase functions init <name> [--dir ./functions] [--force]")
	}
	if args[0] != "init" {
		return fmt.Errorf("unknown functions command %q", args[0])
	}

	fs := flag.NewFlagSet("functions init", flag.ContinueOnError)
	fs.SetOutput(os.Stdout)

	dir := fs.String("dir", "./functions", "Directory where the function file will be created")
	force := fs.Bool("force", false, "Overwrite existing file")

	if err := fs.Parse(args[1:]); err != nil {
		return err
	}
	if fs.NArg() < 1 {
		return errors.New("missing function name: ozybase functions init <name>")
	}

	name := strings.TrimSpace(fs.Arg(0))
	if !functionNameRegex.MatchString(name) {
		return errors.New("invalid function name: use letters, numbers, underscore, or dash")
	}

	if err := os.MkdirAll(*dir, 0o755); err != nil {
		return fmt.Errorf("create functions directory: %w", err)
	}

	targetFile := filepath.Join(*dir, name+".js")
	if _, err := os.Stat(targetFile); err == nil && !*force {
		return fmt.Errorf("function file already exists: %s (use --force to overwrite)", targetFile)
	}

	if err := os.WriteFile(targetFile, []byte(defaultFunctionTemplate), 0o644); err != nil {
		return fmt.Errorf("write function template: %w", err)
	}

	fmt.Printf("function template created: %s\n", targetFile)
	return nil
}
