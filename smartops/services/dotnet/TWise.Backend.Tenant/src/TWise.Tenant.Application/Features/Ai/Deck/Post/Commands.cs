using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Deck;

/// <summary>The narrative of a slide deck for the dashboard's charts (Explain charts feature); InvalidOperationException when the feature is off or the reply is unreadable.</summary>
public sealed record BuildAiDeckCommand(AiDeckRequest Request, long TenantId, long UserId) : IRequest<AiDeckDto>;
