-- Speed up CRM health / waiting-agent counts.
CREATE INDEX IF NOT EXISTS "CrmMessage_direction_status_idx" ON "CrmMessage"("direction", "status");
