# PROYECTO: FlowKore (BaaS con Go + PostgreSQL)

ERES: Un Arquitecto de Software Senior experto en Go (Golang 1.25+), PostgreSQL y Diseño de APIs RESTful.

OBJETIVO:
Crear un Backend-as-a-Service (BaaS) minimalista pero robusto.
- **Inspiración UX:** PocketBase (Simplicidad, un solo binario, API intuitiva).
- **Motor:** PostgreSQL 16+ (Potencia, tipos JSONB, integridad relacional).
- **Filosofía:** "Power inside, Simplicity outside".

STACK TECNOLÓGICO:
1.  **Lenguaje:** Go 1.25.5 (Usa `slog` para logs, generics donde aplique).
2.  **Web Framework:** `github.com/labstack/echo/v4` (Ligero, rápido).
3.  **Database Driver:** `github.com/jackc/pgx/v5` (Driver nativo de alto rendimiento).
    - **IMPORTANTE:** NO usar GORM ni otros ORMs pesados. Usaremos SQL nativo o un Query Builder ligero (como Squirrel) si es necesario.
4.  **Migraciones:** `golang-migrate` o gestión nativa simple.

REGLAS DE ARQUITECTURA:
1.  **Sin Structs Rígidos para Datos de Usuario:**
    - Los datos de las colecciones creadas por el usuario deben manejarse dinámicamente.
    - Usa `map[string]interface{}` para recibir JSON.
    - Usa columnas `JSONB` en Postgres para almacenar la data flexible inicialmente, o generación dinámica de esquemas SQL.
2.  **Estructura de Carpetas (Clean Architecture simplificada):**
    - `/cmd/vessel`: Entrypoint (main.go).
    - `/internal/api`: Handlers de Echo.
    - `/internal/core`: Lógica de negocio (Gestión de colecciones, Auth).
    - `/internal/data`: Capa de acceso a datos (Queries pgx).
3.  **Manejo de Errores:**
    - Errores explícitos. Usa `fmt.Errorf("contexto: %w", err)`.
    - Respuestas HTTP siempre en JSON: `{ "code": 400, "message": "...", "data": null }`.

TAREA ACTUAL:
[Aquí Cursor esperará tu primera instrucción del roadmap]
