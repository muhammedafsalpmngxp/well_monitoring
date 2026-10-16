/* ============================================================================
   core.LearnVideos -- the "Learn" video shown on each builder screen.

   The MP4 itself lives in object storage (S3 / CloudFront); this table holds
   its URL and the Quick Chapters markers so a video can be replaced without
   a deployment. One active row per screen_key.

   Idempotent: safe to re-run. Seed rows are inserted only when the screen
   has no row yet, so an operator's URL is never overwritten.
   ============================================================================ */
IF SCHEMA_ID(N'core') IS NULL EXEC(N'CREATE SCHEMA core');
GO
IF OBJECT_ID(N'core.LearnVideos', N'U') IS NULL
CREATE TABLE core.LearnVideos (
    id             bigint         IDENTITY(1,1) NOT NULL CONSTRAINT PK_core_LearnVideos PRIMARY KEY,
    screen_key     nvarchar(50)   NOT NULL,
    title          nvarchar(200)  NOT NULL,
    video_url      nvarchar(2000) NOT NULL,
    poster_url     nvarchar(2000) NULL,
    chapters_json  nvarchar(max)  NULL,
    is_active      bit            NOT NULL CONSTRAINT DF_core_LearnVideos_is_active DEFAULT 1,
    created_at     datetime2(7)   NOT NULL CONSTRAINT DF_core_LearnVideos_created_at DEFAULT SYSUTCDATETIME(),
    modified_at    datetime2(7)   NOT NULL CONSTRAINT DF_core_LearnVideos_modified_at DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_core_LearnVideos_screen_key')
    CREATE INDEX IX_core_LearnVideos_screen_key ON core.LearnVideos (screen_key);
GO

/* Sample rows. Replace video_url with the S3 object URL of the real recording, e.g.
   https://<bucket>.s3.<region>.amazonaws.com/learn/chart-builder-overview.mp4
   The bucket (or its CloudFront distribution) must allow public GET or serve pre-signed URLs,
   and its CORS policy must allow the TWise origin. */
IF NOT EXISTS (SELECT 1 FROM core.LearnVideos WHERE screen_key = N'chart-builder')
INSERT INTO core.LearnVideos (screen_key, title, video_url, poster_url, chapters_json) VALUES (
    N'chart-builder',
    N'Build and customise charts',
    N'https://twise-learn-videos.s3.ap-south-1.amazonaws.com/learn/chart-builder-overview.mp4',
    NULL,
    N'[{"id":"choose-type","label":"Choose Chart Type","time":0,"durationLabel":"1:20"},
       {"id":"add-data","label":"Add Data","time":80,"durationLabel":"1:20"},
       {"id":"use-filters","label":"Use Filters","time":160,"durationLabel":"1:20"},
       {"id":"save-publish","label":"Save & Publish","time":240,"durationLabel":"1:20"}]');
GO
IF NOT EXISTS (SELECT 1 FROM core.LearnVideos WHERE screen_key = N'report-builder')
INSERT INTO core.LearnVideos (screen_key, title, video_url, poster_url, chapters_json) VALUES (
    N'report-builder',
    N'Build reports',
    N'https://twise-learn-videos.s3.ap-south-1.amazonaws.com/learn/report-builder-overview.mp4',
    NULL,
    N'[{"id":"add-widgets","label":"Add Widgets","time":0,"durationLabel":"1:20"},
       {"id":"charts-tile","label":"Charts & Tile","time":80,"durationLabel":"1:20"},
       {"id":"use-filters","label":"Use Filters","time":160,"durationLabel":"1:20"},
       {"id":"save-share","label":"Save & Share","time":240,"durationLabel":"1:20"}]');
GO
