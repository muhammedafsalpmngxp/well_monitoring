using MediatR;
using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai.Dictionary;

/// <summary>Drafts the dictionary of one dataset (Kind import | view) with AI; null when the dataset does not exist.</summary>
public sealed record DraftDictionaryCommand(string Kind, long Id, long TenantId, long UserId) : IRequest<DictionaryDraftDto?>;
