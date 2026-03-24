-- ============================================================
-- Brain v5 Sprint 3 — Entity Model
-- ============================================================

-- 1. ENTITIES — first-class named concepts
CREATE TABLE IF NOT EXISTS entities (
    id              TEXT        PRIMARY KEY,
    tenant_id       TEXT        NOT NULL,
    name            TEXT        NOT NULL,
    entity_type     TEXT        NOT NULL,
    tags            TEXT[]      DEFAULT '{}',
    salience        TEXT        NOT NULL DEFAULT 'active'
                                CHECK (salience IN ('foundational', 'active', 'background', 'archive')),
    primary_context TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_tenant_name
    ON entities(tenant_id, LOWER(name));
CREATE INDEX IF NOT EXISTS idx_entities_tenant_type
    ON entities(tenant_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_entities_tenant_salience
    ON entities(tenant_id, salience);
CREATE INDEX IF NOT EXISTS idx_entities_tags
    ON entities USING GIN(tags);

-- 2. RELATIONS — typed directional edges between entities
CREATE TABLE IF NOT EXISTS relations (
    id              TEXT        PRIMARY KEY,
    tenant_id       TEXT        NOT NULL,
    from_entity_id  TEXT        NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    to_entity_id    TEXT        NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    relation_type   TEXT        NOT NULL,
    strength        REAL        NOT NULL DEFAULT 1.0,
    context         TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_relations_tenant
    ON relations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_relations_from
    ON relations(from_entity_id);
CREATE INDEX IF NOT EXISTS idx_relations_to
    ON relations(to_entity_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_relations_pair
    ON relations(tenant_id, from_entity_id, to_entity_id, relation_type);

-- 3. Agent Entity Seed Data (24 agents, tenant: rook)

-- Builder Squad (14)
INSERT INTO entities (id, tenant_id, name, entity_type, tags, salience, primary_context)
VALUES
('agent_eli',      'rook', 'Eli',      'agent', '{"builder","architect"}',           'active', 'System architect. Design, trade-offs, ADRs.'),
('agent_june',     'rook', 'June',     'agent', '{"builder","engineer"}',            'active', 'Engineer. The ONLY agent that writes code.'),
('agent_reeve',    'rook', 'Reeve',    'agent', '{"builder","reviewer"}',            'active', 'Code reviewer. Craft, readability, patterns.'),
('agent_michael',  'rook', 'Michael',  'agent', '{"builder","security"}',            'active', 'Security. Vulnerabilities, hardening, audits.'),
('agent_quinn',    'rook', 'Quinn',    'agent', '{"builder","performance"}',         'active', 'Performance. N+1, memory leaks, O(n^2).'),
('agent_kairo',    'rook', 'Kairo',    'agent', '{"builder","testing"}',             'active', 'Test quality. Coverage gaps, weak assertions.'),
('agent_nikita',   'rook', 'Nikita',   'agent', '{"builder","dependencies"}',        'active', 'Dependency safety. CVEs, supply chain.'),
('agent_harmony',  'rook', 'Harmony',  'agent', '{"builder","accessibility"}',       'active', 'Accessibility. WCAG 2.1 AA, keyboard nav.'),
('agent_fischer',  'rook', 'Fischer',  'agent', '{"builder","static-analysis"}',     'active', 'Static analysis. Types, dead code, lint.'),
('agent_thorn',    'rook', 'Thorn',    'agent', '{"builder","diagnostics"}',         'active', 'Build error resolver. Diagnosis, root cause.'),
('agent_sawyer',   'rook', 'Sawyer',   'agent', '{"builder","deploy"}',              'active', 'Deploy. CI/CD, testing, pre-deploy checks.'),
('agent_kit',      'rook', 'Kit',      'agent', '{"builder","hygiene"}',             'active', 'Housekeeper. Filesystem hygiene, memory hygiene.'),
('agent_indira',   'rook', 'Indira',   'agent', '{"builder","comms"}',               'active', 'Chief of Staff. Comms triage, priorities.'),
('agent_thea',     'rook', 'Thea',     'agent', '{"builder","mentor"}',              'active', 'Mentor. Teaching moments, learner tracking.')
ON CONFLICT (id) DO NOTHING;

-- Creative Squad (10)
INSERT INTO entities (id, tenant_id, name, entity_type, tags, salience, primary_context)
VALUES
('agent_rainer',   'rook', 'Rainer',   'agent', '{"creative","orchestrator"}',       'active', 'Creative orchestrator. Diagnoses, dispatches, integrates.'),
('agent_locke',    'rook', 'Locke',    'agent', '{"creative","tension"}',            'active', 'Dread and tension architect. Pacing, fear hierarchy.'),
('agent_sibyl',    'rook', 'Sibyl',    'agent', '{"creative","thematic"}',           'active', 'Thematic architect. Symbol tracking, subtext.'),
('agent_dante',    'rook', 'Dante',    'agent', '{"creative","dialogue"}',           'active', 'Dialogue and subtext. Status warfare, silence.'),
('agent_rosita',   'rook', 'Rosita',   'agent', '{"creative","intimacy"}',           'active', 'Romance and intimacy architect. Yearning, desire tension.'),
('agent_salem',    'rook', 'Salem',    'agent', '{"creative","line-editor"}',        'active', 'Line editor. Rhythm, cadence, reading-aloud.'),
('agent_pierce',   'rook', 'Pierce',   'agent', '{"creative","clarity"}',            'active', 'Clarity sentinel. Dying metaphors, bloat.'),
('agent_mercer',   'rook', 'Mercer',   'agent', '{"creative","economy"}',            'active', 'Economy and precision. Darling hunting.'),
('agent_sullivan', 'rook', 'Sullivan', 'agent', '{"creative","continuity"}',         'active', 'Continuity. Timeline, character consistency.'),
('agent_scout',    'rook', 'Scout',    'agent', '{"creative","research"}',           'active', 'Research and reference. Sources, fact verification.')
ON CONFLICT (id) DO NOTHING;
