-- GrainShield notification-service schema
-- SMS/USSD message templates and delivery tracking

BEGIN;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TYPE channel_enum AS ENUM ('sms', 'ussd', 'push');
CREATE TYPE delivery_status_enum AS ENUM ('pending', 'sent', 'delivered', 'failed', 'expired');
CREATE TYPE notification_category_enum AS ENUM (
    'registration', 'policy_created', 'policy_expiry',
    'trigger_alert', 'claim_payout', 'price_update',
    'aflatoxin_warning', 'weather_alert', 'input_verified',
    'credit_approved', 'sell_confirmation', 'general'
);

-- ─── NOTIFICATION TEMPLATES ─────────────────────────────────────────────────

CREATE TABLE notification_templates (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category    notification_category_enum NOT NULL,
    channel     channel_enum NOT NULL,
    language    VARCHAR(5) NOT NULL DEFAULT 'sw',
    subject     VARCHAR(100),
    body        TEXT NOT NULL,
    variables   TEXT[],               -- placeholders like {{farmer_name}}, {{amount}}
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_templates_unique ON notification_templates (category, channel, language);

-- ─── NOTIFICATIONS SENT ─────────────────────────────────────────────────────

CREATE TABLE notifications (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    template_id     UUID REFERENCES notification_templates(id),
    farmer_id       UUID,
    phone           VARCHAR(13) NOT NULL,
    channel         channel_enum NOT NULL,
    category        notification_category_enum NOT NULL,
    body            TEXT NOT NULL,               -- Rendered content
    status          delivery_status_enum NOT NULL DEFAULT 'pending',
    provider_ref    VARCHAR(100),                -- Safaricom/Africastalking ref
    retry_count     INTEGER NOT NULL DEFAULT 0,
    sent_at         TIMESTAMPTZ,
    delivered_at    TIMESTAMPTZ,
    failed_reason   VARCHAR(500),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notif_farmer ON notifications (farmer_id);
CREATE INDEX idx_notif_status ON notifications (status);
CREATE INDEX idx_notif_category ON notifications (category);
CREATE INDEX idx_notif_phone ON notifications (phone);

-- ─── SEED: Kiswahili SMS Templates ──────────────────────────────────────────

INSERT INTO notification_templates (category, channel, language, subject, body, variables) VALUES
    ('registration', 'sms', 'sw', 'Karibu GrainShield',
     'Karibu GrainShield, {{farmer_name}}! Nambari yako ni {{gs_number}}. Piga *384# kuanza bima ya nafaka.',
     ARRAY['farmer_name', 'gs_number']),

    ('policy_created', 'sms', 'sw', 'Bima Imeundwa',
     'Bima ya nafaka imeundwa! Mkataba: {{contract_id}}. Mifuko: {{bags}}. Thamani: KES {{value}}. Malipo ya bima: KES {{premium}}. Blockchain: {{hash}}',
     ARRAY['contract_id', 'bags', 'value', 'premium', 'hash']),

    ('claim_payout', 'sms', 'sw', 'Malipo Yametumwa',
     'PONGEZI {{farmer_name}}! KES {{amount}} imetumwa kwa M-Pesa yako. Sababu: {{trigger_type}}. Ref: {{payment_ref}}. Hakuna fomu, hakuna ofisi.',
     ARRAY['farmer_name', 'amount', 'trigger_type', 'payment_ref']),

    ('price_update', 'sms', 'sw', 'Bei za Mahindi',
     'BEI ZA MAHINDI wiki hii: {{prices}}. Jibu: UUZA (uza sasa), SHIKA (endelea kushika), MKOPO (omba mkopo). *384#',
     ARRAY['prices']),

    ('aflatoxin_warning', 'sms', 'sw', 'Tahadhari Aflatoxin',
     'TAHADHARI: Hatari ya aflatoxin katika {{sub_county}} ni {{risk_score}}/100. Chunguza nafaka zako. Piga *384# kwa maelezo.',
     ARRAY['sub_county', 'risk_score']),

    ('weather_alert', 'sms', 'sw', 'Tahadhari Hali ya Hewa',
     'TAHADHARI: {{event_type}} inatarajiwa katika {{sub_county}}. Hakikisha nafaka zako ziko salama. Bima yako inafanya kazi.',
     ARRAY['event_type', 'sub_county']),

    ('input_verified', 'sms', 'sw', 'Mbolea Imethibitishwa',
     'Mbolea {{product_name}} IMETHIBITISHWA na KEBS. Nambari: {{serial}}. Upata punguzo la 25% kwenye bima!',
     ARRAY['product_name', 'serial']),

    ('credit_approved', 'sms', 'sw', 'Mkopo Umeidhinishwa',
     'Mkopo wa KES {{amount}} umeidhinishwa! Utatumwa kwa M-Pesa ndani ya masaa 24. Dhamana: Risiti ya ghala {{receipt}}.',
     ARRAY['amount', 'receipt']);

COMMIT;
