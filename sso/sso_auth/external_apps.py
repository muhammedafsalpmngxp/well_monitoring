"""
External Application Launch - Reverse Proxy SSO Pattern

This module implements a reverse proxy pattern for launching external
SaaS applications (like Vise) that don't support standard SSO protocols.

Flow:
1. User clicks app tile → hits /auth/launch/<app_key>/
2. Django authenticates with the target app server-side (handles CSRF etc.)
3. Django stores the authenticated session cookies
4. Django proxies the target app's dashboard through our domain
5. User sees the target app fully authenticated

This is the same approach enterprise SSO products (Okta SWA) use.
"""

import requests
import re
import json
from urllib.parse import urljoin, urlparse, urlunparse
from django.http import HttpResponse, HttpResponseRedirect, JsonResponse
from django.views import View
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator


# External app configurations - stored server-side for security
# In production, move credentials to environment variables or a secrets manager
EXTERNAL_APPS = {
    'vise': {
        'name': 'Vise',
        'base_url': 'https://vise.blacksmithsoft.com',
        'login_url': 'https://vise.blacksmithsoft.com/login/',
        'credentials': {
            'username': 'test@ong.altasnim.com',
            'password': 'Atg@297677',
        },
    },
}


def _authenticate_vise(session):
    """
    Authenticate with Vise server-side.
    Returns True if login succeeded, False otherwise.
    """
    config = EXTERNAL_APPS['vise']
    login_url = config['login_url']
    creds = config['credentials']

    # Step 1: GET the login page (get CSRF token + cookie)
    resp = session.get(login_url, timeout=15)
    if resp.status_code != 200:
        return False

    # Extract CSRF token from the form
    csrf_match = re.search(
        r'name=["\']csrfmiddlewaretoken["\']\s*value=["\']([^"\']+)',
        resp.text
    )
    if not csrf_match:
        return False

    csrf_token = csrf_match.group(1)

    # Step 2: POST credentials
    login_data = {
        'csrfmiddlewaretoken': csrf_token,
        'username': creds['username'],
        'password': creds['password'],
        'next': '',
    }
    headers = {
        'Referer': login_url,
        'Origin': config['base_url'],
    }

    resp = session.post(login_url, data=login_data, headers=headers,
                        allow_redirects=False, timeout=15)

    # 302 redirect means successful login
    return resp.status_code in (301, 302)


@method_decorator(csrf_exempt, name='dispatch')
class ExternalLoginView(View):
    """
    Validates user-provided credentials against the external app (Vise).
    Returns success + stores authenticated session if credentials are valid.
    """

    def post(self, request):
        try:
            data = json.loads(request.body)
        except (json.JSONDecodeError, ValueError):
            return JsonResponse({'error': 'Invalid request body'}, status=400)

        username = data.get('username', '').strip()
        password = data.get('password', '')

        if not username or not password:
            return JsonResponse({'error': 'Username and password are required'}, status=400)

        # Validate credentials against the stored Vise credentials
        vise_config = EXTERNAL_APPS['vise']
        valid_username = vise_config['credentials']['username']
        valid_password = vise_config['credentials']['password']

        if username != valid_username or password != valid_password:
            return JsonResponse({'error': 'Invalid credentials'}, status=401)

        # Credentials match — authenticate with Vise server-side
        session = requests.Session()
        success = _authenticate_vise(session)

        if not success:
            return JsonResponse({'error': 'Could not connect to Vise service'}, status=502)

        # Store the authenticated Vise session in Django session
        cookies_dict = {}
        for cookie in session.cookies:
            cookies_dict[cookie.name] = cookie.value
        request.session['ext_cookies_vise'] = cookies_dict
        request.session['ext_base_url_vise'] = vise_config['base_url']
        request.session['authenticated'] = True

        return JsonResponse({
            'message': 'Login successful',
            'redirect': '/applications.html',
        })


@method_decorator(csrf_exempt, name='dispatch')
class LogoutView(View):
    """Clears the server-side session (expires Vise auth cookies) and returns success."""

    def post(self, request):
        request.session.flush()
        return JsonResponse({'message': 'Logged out successfully'})


class ExternalAppLaunchView(View):
    """
    Returns a loading page immediately, then authenticates via AJAX.
    This avoids browser timeout issues from slow external auth.
    """

    def get(self, request, app_key):
        app_config = EXTERNAL_APPS.get(app_key)
        if not app_config:
            return HttpResponse('Application not found', status=404)

        # Return loading page immediately - auth happens via AJAX call to /auth/api/do-auth/<app_key>/
        return HttpResponse(
            self._loading_page(app_config['name'], app_key),
            content_type='text/html'
        )

    def _loading_page(self, app_name, app_key):
        return f'''<!DOCTYPE html>
<html><head><title>Launching {app_name}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{ font-family: 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
       display: flex; align-items: center; justify-content: center;
       min-height: 100vh; background: #f5f5f7; color: #1a1a2e; }}
.loader {{ text-align: center; }}
.loader-card {{ background: #ffffff; border: 1px solid rgba(0,0,0,0.08); border-radius: 16px;
              padding: 48px 56px; box-shadow: 0 4px 24px rgba(15,23,42,0.06); }}
.spinner {{ width: 44px; height: 44px; border: 3px solid rgba(13,148,136,0.15);
           border-top-color: #0d9488; border-radius: 50%;
           animation: spin 0.8s linear infinite; margin: 0 auto 24px; }}
@keyframes spin {{ to {{ transform: rotate(360deg); }} }}
h2 {{ font-size: 17px; font-weight: 600; color: #0f172a; margin-bottom: 6px; letter-spacing: -0.2px; }}
p {{ font-size: 12.5px; color: #94a3b8; }}
.error {{ display: none; margin-top: 20px; padding: 12px 16px;
         background: rgba(220,38,38,0.08); border: 1px solid rgba(220,38,38,0.2);
         border-radius: 8px; color: #dc2626; font-size: 12px; }}
</style></head>
<body>
<div class="loader">
  <div class="loader-card">
    <div class="spinner"></div>
    <h2>Launching {app_name}...</h2>
    <p>Authenticating and connecting to live dashboard</p>
    <div class="error" id="err"></div>
  </div>
</div>
<script>
fetch("/auth/api/do-auth/{app_key}/", {{ method: "POST", credentials: "same-origin" }})
  .then(function(r) {{ return r.json(); }})
  .then(function(data) {{
    if (data.success) {{
      window.location.href = "/auth/proxy/{app_key}/";
    }} else {{
      document.getElementById("err").style.display = "block";
      document.getElementById("err").textContent = data.error || "Authentication failed";
    }}
  }})
  .catch(function() {{
    document.getElementById("err").style.display = "block";
    document.getElementById("err").textContent = "Connection error. Please try again.";
  }});
</script>
</body></html>'''

    def _error_page(self, app_name):
        return f'''<!DOCTYPE html>
<html><head><title>Error</title>
<style>
body {{ font-family: sans-serif; display: flex; align-items: center;
       justify-content: center; min-height: 100vh; background: #f5f5f7; }}
.card {{ background: #fff; padding: 40px; border-radius: 12px;
         box-shadow: 0 4px 12px rgba(0,0,0,0.1); text-align: center; max-width: 400px; }}
h2 {{ color: #dc2626; margin-bottom: 12px; }}
p {{ color: #64748b; }}
a {{ color: #2563eb; text-decoration: none; font-weight: 600; }}
</style></head>
<body><div class="card">
<h2>Connection Failed</h2>
<p>Could not authenticate with {app_name}. The service may be temporarily unavailable.</p>
<a href="/auth/dashboard/">← Back to Dashboard</a>
</div></body></html>'''


@method_decorator(csrf_exempt, name='dispatch')
class ExternalAppDoAuthView(View):
    """
    Performs the actual external app authentication (called via AJAX from the loading page).
    This is same-origin so no CORS issues.
    """

    def post(self, request, app_key):
        app_config = EXTERNAL_APPS.get(app_key)
        if not app_config:
            return JsonResponse({'success': False, 'error': 'App not found'}, status=404)

        # Authenticate with the external app
        session = requests.Session()
        success = False

        if app_key == 'vise':
            success = _authenticate_vise(session)

        if not success:
            return JsonResponse({
                'success': False,
                'error': f'Could not connect to {app_config["name"]}. Service may be unavailable.'
            }, status=502)

        # Store authenticated session cookies in Django session
        cookies_dict = {}
        for cookie in session.cookies:
            cookies_dict[cookie.name] = cookie.value
        request.session[f'ext_cookies_{app_key}'] = cookies_dict
        request.session[f'ext_base_url_{app_key}'] = app_config['base_url']

        return JsonResponse({'success': True})


@method_decorator(csrf_exempt, name='dispatch')
class ExternalAppProxyView(View):
    """
    Reverse proxy that forwards requests to the authenticated external app.
    Rewrites URLs in HTML responses to route through our proxy.
    """

    def get(self, request, app_key, path=''):
        return self._proxy_request(request, app_key, path)

    def post(self, request, app_key, path=''):
        return self._proxy_request(request, app_key, path)

    def _proxy_request(self, request, app_key, path):
        # Intercept logout from the external app — redirect back to applications page
        if path.strip('/') in ('logout', 'users/logout', 'accounts/logout', 'auth/logout'):
            return HttpResponseRedirect('/applications/')

        # Get stored session cookies
        cookies = request.session.get(f'ext_cookies_{app_key}')
        base_url = request.session.get(f'ext_base_url_{app_key}')

        if not cookies or not base_url:
            # Not authenticated yet - redirect to launch
            return HttpResponseRedirect(f'/auth/launch/{app_key}/')

        # Build target URL
        target_url = f"{base_url}/{path}"
        if request.META.get('QUERY_STRING'):
            target_url += f"?{request.META['QUERY_STRING']}"

        # Forward the request using a cookie jar (avoids CookieConflictError)
        session = requests.Session()
        # Clear default cookies and set from stored dict using proper jar
        session.cookies.clear()
        for name, value in cookies.items():
            session.cookies.set(name, value, domain=urlparse(base_url).hostname)

        headers = {
            'Referer': base_url + '/',
            'Origin': base_url,
        }

        try:
            if request.method == 'POST':
                resp = session.post(
                    target_url,
                    data=request.body,
                    headers=headers,
                    allow_redirects=False,
                    timeout=30
                )
            else:
                resp = session.get(
                    target_url,
                    headers=headers,
                    allow_redirects=False,
                    timeout=30
                )
        except requests.RequestException as e:
            return HttpResponse(f'Proxy error: {e}', status=502)

        # Handle redirects - rewrite location header
        if resp.status_code in (301, 302, 303, 307, 308):
            location = resp.headers.get('Location', '')
            # If external app redirects to its login page, go back to our applications page
            if '/login' in location:
                return HttpResponseRedirect('/applications/')
            if location.startswith('/'):
                location = f'/auth/proxy/{app_key}{location}'
            elif location.startswith(base_url):
                location = location.replace(base_url, f'/auth/proxy/{app_key}', 1)
            return HttpResponseRedirect(location)

        # Update stored cookies if server set new ones
        if session.cookies:
            updated_cookies = {}
            for cookie in session.cookies:
                updated_cookies[cookie.name] = cookie.value
            request.session[f'ext_cookies_{app_key}'] = updated_cookies

        # Build response
        content_type = resp.headers.get('Content-Type', 'text/html')
        content = resp.content

        # Rewrite URLs in HTML content to go through our proxy
        if 'text/html' in content_type:
            content = self._rewrite_html(content, base_url, app_key)

        response = HttpResponse(content, status=resp.status_code, content_type=content_type)

        # Forward safe headers
        for header in ('Cache-Control', 'ETag', 'Last-Modified'):
            if header in resp.headers:
                response[header] = resp.headers[header]

        return response

    def _rewrite_html(self, content, base_url, app_key):
        """Rewrite URLs in HTML to route through our proxy."""
        html = content.decode('utf-8', errors='replace')
        proxy_base = f'/auth/proxy/{app_key}'

        # Rewrite absolute URLs to the target domain
        html = html.replace(f'href="{base_url}/', f'href="{proxy_base}/')
        html = html.replace(f"href='{base_url}/", f"href='{proxy_base}/")
        html = html.replace(f'action="{base_url}/', f'action="{proxy_base}/')
        html = html.replace(f"action='{base_url}/", f"action='{proxy_base}/")

        # Rewrite root-relative URLs (href="/...", src="/...")
        html = re.sub(
            r'(href|action)="(/[^"]*)"',
            rf'\1="{proxy_base}\2"',
            html
        )
        html = re.sub(
            r"(href|action)='(/[^']*)'",
            rf"\1='{proxy_base}\2'",
            html
        )

        # Don't rewrite static asset URLs (CSS, JS, images from CDN)
        # Those can load directly from their CDN/S3 sources

        # Inject script to intercept AJAX calls and route them through proxy
        ajax_interceptor = f'''<script>
(function() {{
    var proxyBase = "{proxy_base}";
    // Patch fetch
    var origFetch = window.fetch;
    window.fetch = function(url, opts) {{
        if (typeof url === "string" && url.startsWith("/") && !url.startsWith(proxyBase)) {{
            url = proxyBase + url;
        }}
        return origFetch.call(this, url, opts);
    }};
    // Patch XMLHttpRequest
    var origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {{
        if (typeof url === "string" && url.startsWith("/") && !url.startsWith(proxyBase)) {{
            url = proxyBase + url;
        }}
        return origOpen.apply(this, [method, url].concat(Array.prototype.slice.call(arguments, 2)));
    }};
    // Patch jQuery ajax if present
    if (window.jQuery) {{
        jQuery.ajaxPrefilter(function(options) {{
            if (options.url && options.url.startsWith("/") && !options.url.startsWith(proxyBase)) {{
                options.url = proxyBase + options.url;
            }}
        }});
    }}
}})();
</script>'''
        # Inject before </head> or at the start of <body>
        if '</head>' in html:
            html = html.replace('</head>', ajax_interceptor + '</head>', 1)
        elif '<body' in html:
            html = re.sub(r'(<body[^>]*>)', r'\1' + ajax_interceptor, html, count=1)

        return html.encode('utf-8')
