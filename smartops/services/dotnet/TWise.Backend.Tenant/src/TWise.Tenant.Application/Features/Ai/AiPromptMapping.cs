using TWise.Tenant.Domain.DTOs;

namespace TWise.Tenant.Application.Features.Ai;

public static class AiPromptMapping
{
    /// <summary>The AI-feature prompts as the former AI instructions list: DefaultText is the original (version 1),
    /// IsCustom whether the text in use differs from it.</summary>
    public static IReadOnlyList<AiPromptDto> FeatureDtos(IReadOnlyList<AiPromptItemDto> items) =>
        items.Where(i => i.Group == AiPromptCatalog.Features)
            .Select(i => new AiPromptDto(i.Key, i.Name, i.Description, i.OriginalText, i.Text, i.Text != i.OriginalText))
            .ToList();
}
