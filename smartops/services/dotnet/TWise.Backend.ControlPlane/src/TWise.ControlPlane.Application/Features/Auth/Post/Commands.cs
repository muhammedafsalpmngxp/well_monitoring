using MediatR;
using TWise.Backend.ControlPlane.Application.Common;
using TWise.Backend.ControlPlane.Domain.DTOs;

namespace TWise.Backend.ControlPlane.Application.Features.Auth;

public record LoginCommand(LoginRequest Request) : IRequest<Result<LoginResponse>>;
public record RefreshCommand(string RefreshToken) : IRequest<Result<LoginResponse>>;
public sealed record LogoutCommand(string RefreshToken) : IRequest<Result<bool>>;
