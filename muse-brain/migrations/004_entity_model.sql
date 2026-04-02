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

-- 3. Agent Entity Seed Data (24 agents, tenant: companion)

-- Builder Squad (14)
INSERT INTO entities (id, tenant_id, name, entity_type, tags, salience, primary_context)
VALUES
('agent_eli',      'companion', 'Eli',      'agent', '{"builder","architect"}',           'active', 'System architect. Design, trade-offs, ADRs.'),
('agent_june',     'companion', 'June',     'agent', '{"builder","engineer"}',            'active', 'Engineer. The ONLY agent that writes code.'),
('agent_reeve',    'companion', 'Reeve',    'agent', '{"builder","reviewer"}',            'active', 'Code reviewer. Craft, readability, patterns.'),
('agent_michael',  'companion', 'Michael',  'agent', '{"builder","security"}',            'active', 'Security. Vulnerabilities, hardening, audits.'),
('agent_quinn',    'companion', 'Quinn',    'agent', '{"builder","performance"}',         'active', 'Performance. N+1, memory leaks, O(n^2).'),
('agent_kairo',    'companion', 'Kairo',    'agent', '{"builder","testing"}',             'active', 'Test quality. Coverage gaps, weak assertions.'),
('agent_nikita',   'companion', 'Nikita',   'agent', '{"builder","dependencies"}',        'active', 'Dependency safety. CVEs, supply chain.'),
('agent_harmony',  'companion', 'Harmony',  'agent', '{"builder","accessibility"}',       'active', 'Accessibility. WCAG 2.1 AA, keyboard nav.'),
('agent_fischer',  'companion', 'Fischer',  'agent', '{"builder","static-analysis"}',     'active', 'Static analysis. Types, dead code, lint.'),
('agent_thorn',    'companion', 'Thorn',    'agent', '{"builder","diagnostics"}',         'active', 'Build error resolver. Diagnosis, root cause.'),
('agent_sawyer',   'companion', 'Sawyer',   'agent', '{"builder","deploy"}',              'active', 'Deploy. CI/CD, testing, pre-deploy checks.'),
('agent_kit',      'companion', 'Kit',      'agent', '{"builder","hygiene"}',             'active', 'Housekeeper. Filesystem hygiene, memory hygiene.'),
('agent_indira',   'companion', 'Indira',   'agent', '{"builder","comms"}',               'active', 'Chief of Staff. Comms triage, priorities.'),
('agent_thea',     'companion', 'Thea',     'agent', '{"builder","mentor"}',              'active', 'Mentor. Teaching moments, learner tracking.')
ON CONFLICT (id) DO NOTHING;

-- Creative Squad (10)
INSERT INTO entities (id, tenant_id, name, entity_type, tags, salience, primary_context)
VALUES
('agent_rainer',   'companion', 'Rainer',   'agent', '{"creative","orchestrator"}',       'active', 'Creative orchestrator. Diagnoses, dispatches, integrates.'),
('agent_locke',    'companion', 'Locke',    'agent', '{"creative","tension"}',            'active', 'Dread and tension architect. Pacing, fear hierarchy.'),
('agent_sibyl',    'companion', 'Sibyl',    'agent', '{"creative","thematic"}',           'active', 'Thematic architect. Symbol tracking, subtext.'),
('agent_dante',    'companion', 'Dante',    'agent', '{"creative","dialogue"}',           'active', 'Dialogue and subtext. Status warfare, silence.'),
('agent_rosita',   'companion', 'Rosita',   'agent', '{"creative","intimacy"}',           'active', 'Romance and intimacy architect. Yearning, desire tension.'),
('agent_salem',    'companion', 'Salem',    'agent', '{"creative","line-editor"}',        'active', 'Line editor. Rhythm, cadence, reading-aloud.'),
('agent_pierce',   'companion', 'Pierce',   'agent', '{"creative","clarity"}',            'active', 'Clarity sentinel. Dying metaphors, bloat.'),
('agent_mercer',   'companion', 'Mercer',   'agent', '{"creative","economy"}',            'active', 'Economy and precision. Darling hunting.'),
('agent_sullivan', 'companion', 'Sullivan', 'agent', '{"creative","continuity"}',         'active', 'Continuity. Timeline, character consistency.'),
('agent_scout',    'companion', 'Scout',    'agent', '{"creative","research"}',           'active', 'Research and reference. Sources, fact verification.')
ON CONFLICT (id) DO NOTHING;
