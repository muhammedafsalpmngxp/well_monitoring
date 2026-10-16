from django.urls import path
from .external_apps import ExternalAppLaunchView, ExternalAppProxyView, ExternalLoginView, ExternalAppDoAuthView, LogoutView

urlpatterns = [
    # Vise SSO - credential validation (used by login_new.html)
    path('api/external-login/', ExternalLoginView.as_view(), name='external-login'),

    # Logout - flush server session
    path('api/logout/', LogoutView.as_view(), name='logout'),

    # Vise SSO - launch and authentication
    path('launch/<str:app_key>/', ExternalAppLaunchView.as_view(), name='external-app-launch'),
    path('api/do-auth/<str:app_key>/', ExternalAppDoAuthView.as_view(), name='external-app-do-auth'),

    # Vise SSO - reverse proxy
    path('proxy/<str:app_key>/', ExternalAppProxyView.as_view(), name='external-app-proxy-root'),
    path('proxy/<str:app_key>/<path:path>', ExternalAppProxyView.as_view(), name='external-app-proxy'),
]
