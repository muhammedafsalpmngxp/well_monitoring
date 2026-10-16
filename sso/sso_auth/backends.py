from django.contrib.auth.backends import ModelBackend
from .models import SSOUser


class EmailBackend(ModelBackend):
    """Authenticate using email instead of username."""

    def authenticate(self, request, email=None, password=None, **kwargs):
        try:
            user = SSOUser.objects.get(email=email)
        except SSOUser.DoesNotExist:
            return None

        if user.check_password(password) and self.user_can_authenticate(user):
            return user
        return None
