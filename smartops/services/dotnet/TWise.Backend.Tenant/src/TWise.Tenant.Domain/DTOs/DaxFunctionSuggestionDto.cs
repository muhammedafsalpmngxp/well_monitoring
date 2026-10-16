namespace TWise.Tenant.Domain.DTOs;

/// <summary>One row of dbo.usp_DaxSuggest: a DAX function offered by smart compose.</summary>
public sealed class DaxFunctionSuggestionDto
{
    public string FunctionName { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;
    public string Syntax { get; set; } = string.Empty;
    public string ReturnType { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;

    /// <summary>Snippet syntax, e.g. SUM(${1:ColumnName})$0.</summary>
    public string InsertSnippet { get; set; } = string.Empty;
    public byte MinArgs { get; set; }
    public byte? MaxArgs { get; set; }
    public bool IsNotRecommended { get; set; }
    public bool IsDeprecated { get; set; }
    public string? DocUrl { get; set; }
}
