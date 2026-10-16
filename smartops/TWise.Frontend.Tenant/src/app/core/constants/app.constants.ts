export const APP_CONSTANTS = {
  APP_NAME: 'AI Tasnim — T-Wise',
  APP_VERSION: 'v1.0.0',
  COPYRIGHT: '© 2026 NGXP Technologies. All rights reserved.',

  STORAGE_KEYS: {
    ACCESS_TOKEN:  'tw_access_token',
    REFRESH_TOKEN: 'tw_refresh_token',
    USER_DATA:     'tw_user_data',
    CREW_CALENDAR_SESSION: 'tw_crew_calendar:v1:',
    LANGUAGE:      'tw_language',
    THEME:         'tw_theme',
  },

  PAGINATION: {
    DEFAULT_PAGE:      1,
    DEFAULT_PAGE_SIZE: 10,
    PAGE_SIZE_OPTIONS: [10, 25, 50, 100],
  },

  DATE_FORMAT: {
    DISPLAY:  'DD-MMM-YY',
    API:      'YYYY-MM-DD',
    DATETIME: 'DD-MMM-YY HH:mm',
  },
} as const;
