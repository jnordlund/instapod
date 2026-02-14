export const DEFAULT_TITLE_PROMPT_TEMPLATE =
    "You are a translator. Translate the following title to {{target_language}}. Return only the translated title, nothing else.";

export const DEFAULT_TEXT_PROMPT_TEMPLATE =
    "You are a translator. Translate the following text to {{target_language}}. Preserve paragraph breaks. Return only the translated text, nothing else.";

export function resolveTranslationPrompt(
    template: string | undefined,
    targetLanguage: string,
    fallbackTemplate: string
): string {
    const source = template && template.trim().length > 0
        ? template
        : fallbackTemplate;

    return source.replace(/\{\{\s*target_language\s*\}\}/g, targetLanguage);
}
