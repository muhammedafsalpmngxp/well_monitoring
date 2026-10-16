using MediatR;
using TWise.Backend.ControlPlane.Application.Abstractions.Services;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.Application.Features.Auth;

public sealed class LoginHandler(IAuthService auth) : IRequestHandler<LoginCommand, Result<LoginResponse>>
{
    public async Task<Result<LoginResponse>> Handle(LoginCommand cmd, CancellationToken cancellationToken)
    {
        try
        {
            return await auth.LoginAsync(cmd.Request, cancellationToken);
        }
        catch (AccountLockedException ex)
        {
            // Too many failed attempts: 401 with the minutes left, not a server error.
            return Result<LoginResponse>.Unauthorized(ex.Message);
        }
    }
}

public sealed class RefreshHandler(IAuthService auth) : IRequestHandler<RefreshCommand, Result<LoginResponse>>
{
    public async Task<Result<LoginResponse>> Handle(RefreshCommand cmd, CancellationToken cancellationToken)
    {
        var response = await auth.RefreshAsync(cmd.RefreshToken, cancellationToken);
        return response is null
            ? Result<LoginResponse>.Unauthorized("Invalid or expired refresh token.")
            : Result<LoginResponse>.Success(response);
    }
}

public sealed class LogoutHandler(IAuthService auth) : IRequestHandler<LogoutCommand, Result<bool>>
{
    public async Task<Result<bool>> Handle(LogoutCommand cmd, CancellationToken cancellationToken)
    {
        return await auth.LogoutAsync(cmd.RefreshToken, cancellationToken)
            ? Result<bool>.Success(true)
            : Result<bool>.Unauthorized("Invalid or expired session.");
    }
}
