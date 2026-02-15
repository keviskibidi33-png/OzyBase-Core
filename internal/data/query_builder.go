package data

import (
	"fmt"
	"strings"
)

// QueryBuilder provides a structured and safe way to build SQL queries
type QueryBuilder struct {
	tableName    string
	whereClauses []string
	args         []any
	argIdx       int
	orderBy      string
	limit        int
	offset       int
}

// NewQueryBuilder initializes a builder for a specific table
func NewQueryBuilder(tableName string) *QueryBuilder {
	return &QueryBuilder{
		tableName: tableName,
		argIdx:    1,
		args:      []any{},
	}
}

// Where adds a refined filter to the query
func (qb *QueryBuilder) Where(column, operator string, value any) *QueryBuilder {
	if !IsValidIdentifier(column) {
		return qb
	}

	sqlOp := "="
	colExpr := column
	switch strings.ToLower(operator) {
	case "eq":
		sqlOp = "="
	case "neq":
		sqlOp = "!="
	case "gt":
		sqlOp = ">"
	case "gte":
		sqlOp = ">="
	case "lt":
		sqlOp = "<"
	case "lte":
		sqlOp = "<="
	case "like", "ilike":
		sqlOp = "ILIKE"
		colExpr = fmt.Sprintf("%s::text", column)
		if strVal, ok := value.(string); ok && !strings.Contains(strVal, "%") {
			value = "%" + strVal + "%"
		}
	}

	qb.whereClauses = append(qb.whereClauses, fmt.Sprintf("%s %s $%d", colExpr, sqlOp, qb.argIdx))
	qb.args = append(qb.args, value)
	qb.argIdx++
	return qb
}

// Order sets the sorting rule
func (qb *QueryBuilder) Order(orderBy string) *QueryBuilder {
	if IsValidIdentifier(strings.ReplaceAll(orderBy, ".", "")) {
		qb.orderBy = strings.ReplaceAll(orderBy, ".", " ")
	}
	return qb
}

// Paginate sets limit and offset
func (qb *QueryBuilder) Paginate(limit, offset int) *QueryBuilder {
	qb.limit = limit
	qb.offset = offset
	return qb
}

// BuildSelect generates the final SELECT query and its arguments
func (qb *QueryBuilder) BuildSelect() (string, []any) {
	where := ""
	if len(qb.whereClauses) > 0 {
		where = " WHERE " + strings.Join(qb.whereClauses, " AND ")
	}

	order := ""
	if qb.orderBy != "" {
		order = " ORDER BY " + qb.orderBy
	}

	limits := ""
	if qb.limit > 0 {
		limits = fmt.Sprintf(" LIMIT %d", qb.limit)
	}
	if qb.offset > 0 {
		limits += fmt.Sprintf(" OFFSET %d", qb.offset)
	}

	query := fmt.Sprintf("SELECT * FROM %s%s%s%s", qb.tableName, where, order, limits)
	return query, qb.args
}

// BuildCount generates a count query based on the current filters
func (qb *QueryBuilder) BuildCount() (string, []any) {
	where := ""
	if len(qb.whereClauses) > 0 {
		where = " WHERE " + strings.Join(qb.whereClauses, " AND ")
	}
	query := fmt.Sprintf("SELECT COUNT(*) FROM %s%s", qb.tableName, where)
	return query, qb.args
}
