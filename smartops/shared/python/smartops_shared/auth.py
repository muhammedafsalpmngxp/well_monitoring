"""JWT verification — accepts tokens issued by SmartOps.Auth or Azure Entra."""
import os
from typing import Optional
from fastapi import Header, HTTPException, status
from jose import JWTError, jwt


_JWT_SECRET = os.environ.get("JwtSettings__SecretKey",
                              "dev-only-secret-please-change-32-bytes-minimum-length-string")
_JWT_ALG = os.environ.get("JwtSettings__Algorithm", "HS256")
_JWT_ISS = os.environ.get("JwtSettings__Issuer", "smartops.auth")
_JWT_AUD = os.environ.get("JwtSettings__Audience", "smartops.api")
_TENANT_ID = os.environ.get("AzureAd__TenantId", "")


def require_user(authorization: Optional[str] = Header(default=None)) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Missing bearer token")
    token = authorization.split(" ", 1)[1]
    try:
        # Local SmartOps JWT
        return jwt.decode(token, _JWT_SECRET, algorithms=[_JWT_ALG],
                          issuer=_JWT_ISS, audience=_JWT_AUD)
    except JWTError:
        # If Entra is configured, try its keys via jwks (placeholder — wire to msal/python-jose-jwks-uri)
        if _TENANT_ID:
            raise HTTPException(status_code=401, detail="Entra token validation not yet wired")
        raise HTTPException(status_code=401, detail="Invalid token")


def require_role(*roles: str):
    def _checker(user: dict = None) -> dict:
        if user is None:
            user = require_user()
        if user.get("role") not in roles:
            raise HTTPException(status_code=403, detail="Forbidden")
        return user
    return _checker
