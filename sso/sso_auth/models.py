import uuid
from django.contrib.auth.models import AbstractBaseUser, PermissionsMixin
from django.db import models
from django.utils import timezone

from .managers import CustomUserManager


class SSOUser(AbstractBaseUser, PermissionsMixin):
    """Custom user model using email as primary identifier for SSO."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    first_name = models.CharField(max_length=150, blank=True)
    last_name = models.CharField(max_length=150, blank=True)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    date_joined = models.DateTimeField(default=timezone.now)

    objects = CustomUserManager()

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['first_name', 'last_name']

    class Meta:
        db_table = 'sso_users'
        verbose_name = 'SSO User'
        verbose_name_plural = 'SSO Users'

    def __str__(self):
        return self.email


class SSOApplication(models.Model):
    """Registered applications that participate in SSO."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    client_id = models.CharField(max_length=100, unique=True)
    client_secret = models.CharField(max_length=255)
    redirect_url = models.URLField(help_text="URL to redirect after successful SSO login")
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'sso_applications'
        verbose_name = 'SSO Application'
        verbose_name_plural = 'SSO Applications'

    def __str__(self):
        return self.name


class SSOSession(models.Model):
    """Tracks SSO sessions for token management."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(SSOUser, on_delete=models.CASCADE, related_name='sso_sessions')
    application = models.ForeignKey(SSOApplication, on_delete=models.CASCADE, related_name='sessions')
    token_issued_at = models.DateTimeField(auto_now_add=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = 'sso_sessions'
        verbose_name = 'SSO Session'
        verbose_name_plural = 'SSO Sessions'

    def __str__(self):
        return f"{self.user.email} -> {self.application.name}"
