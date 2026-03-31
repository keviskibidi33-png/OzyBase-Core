export interface HealthIssueLike {
    type?: string | null;
    title?: string | null;
    description?: string | null;
}

const normalizeText = (value: unknown): string => String(value || '').trim().toLowerCase();

export const isRLSHealthIssue = (issue: HealthIssueLike): boolean => {
    const title = normalizeText(issue.title);
    return title.includes('row level security') || title.includes('missing rls policies');
};

export const supportsHealthAutoFix = (issue: HealthIssueLike): boolean => {
    const type = normalizeText(issue.type);
    const title = normalizeText(issue.title);

    if (type === 'security') {
        return isRLSHealthIssue(issue) ||
            title.includes('public list rules') ||
            title.includes('geographic access breach');
    }

    if (type === 'performance') {
        return title.includes('missing an index') || title.includes('sequential scans');
    }

    return false;
};
