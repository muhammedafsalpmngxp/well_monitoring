from django.contrib import admin
from .models import SSOUser, SSOApplication, SSOSession


@admin.register(SSOUser)
class SSOUserAdmin(admin.ModelAdmin):
    list_display = ['email', 'first_name', 'last_name', 'is_active', 'date_joined']
    search_fields = ['email', 'first_name', 'last_name']
    list_filter = ['is_active', 'is_staff']
    ordering = ['-date_joined']


@admin.register(SSOApplication)
class SSOApplicationAdmin(admin.ModelAdmin):
    list_display = ['name', 'client_id', 'redirect_url', 'is_active', 'created_at']
    search_fields = ['name', 'client_id']
    list_filter = ['is_active']


@admin.register(SSOSession)
class SSOSessionAdmin(admin.ModelAdmin):
    list_display = ['user', 'application', 'token_issued_at', 'is_active']
    list_filter = ['is_active', 'application']
    search_fields = ['user__email']
