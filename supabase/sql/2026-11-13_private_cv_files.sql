-- Run after deploying the authenticated CV viewer/downloader from this PR.
-- Existing CV references continue to work, and Storage uses the existing
-- authenticated owner policies to authorize file access.
update storage.buckets
set public = false
where id = 'cv-files'
returning id, public;
