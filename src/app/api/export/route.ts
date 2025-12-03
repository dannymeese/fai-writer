import { NextResponse } from "next/server";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { generateDownloadFilename, markdownToPlainText } from "@/lib/utils";
import MarkdownIt from "markdown-it";

export async function POST(request: Request) {
  const { title, content, format = "docx" } = await request.json().catch(() => ({}));

  if (!title || !content) {
    return NextResponse.json({ error: "Title and content required" }, { status: 400 });
  }

  const filename = generateDownloadFilename(title, content, format);

  if (format === "txt") {
    // Strip markdown formatting for plain text
    const plainTitle = markdownToPlainText(title);
    const plainContent = markdownToPlainText(content);
    const textContent = `${plainTitle}\n\n${plainContent}`;
    const blob = new Blob([textContent], { type: "text/plain" });
    const arrayBuffer = await blob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    return new NextResponse(uint8Array, {
      headers: {
        "Content-Type": "text/plain",
        "Content-Disposition": `attachment; filename="${filename}"`
      }
    });
  }

  if (format === "pdf") {
    // For PDF, we'll generate it client-side using jsPDF
    // Return a flag to indicate client-side generation is needed
    return NextResponse.json({ 
      needsClientGeneration: true,
      title,
      content,
      filename: filename
    });
  }

  // Default: DOCX format - parse markdown and apply formatting
  // Preprocess strikethrough: convert ~~text~~ to <s>text</s> for markdown-it parsing
  const preprocessedContent = content.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  
  const md = new MarkdownIt({ html: true }); // Enable HTML parsing for <s> tags
  const tokens = md.parse(preprocessedContent, {});
  
  // Helper function to parse inline markdown tokens to TextRuns
  function parseInlineTokens(tokens: any[], startIndex = 0, bold = false, italic = false, strike = false): { runs: TextRun[]; nextIndex: number } {
    const runs: TextRun[] = [];
    let i = startIndex;
    
    while (i < tokens.length) {
      const token = tokens[i];
      
      if (token.type === "text") {
        if (token.content) {
          runs.push(new TextRun({ 
            text: token.content,
            bold: bold,
            italics: italic,
            strike: strike
          }));
        }
        i++;
      } else if (token.type === "strong_open") {
        // Start bold section - recursively parse until strong_close
        i++;
        const result = parseInlineTokens(tokens, i, true, italic, strike);
        runs.push(...result.runs);
        i = result.nextIndex;
        // Skip the strong_close token
        if (i < tokens.length && tokens[i].type === "strong_close") {
          i++;
        }
      } else if (token.type === "em_open") {
        // Start italic section - recursively parse until em_close
        i++;
        const result = parseInlineTokens(tokens, i, bold, true, strike);
        runs.push(...result.runs);
        i = result.nextIndex;
        // Skip the em_close token
        if (i < tokens.length && tokens[i].type === "em_close") {
          i++;
        }
      } else if (token.type === "s_open" || token.type === "del_open") {
        // Start strikethrough section - recursively parse until s_close or del_close
        i++;
        const result = parseInlineTokens(tokens, i, bold, italic, true);
        runs.push(...result.runs);
        i = result.nextIndex;
        // Skip the closing token
        if (i < tokens.length && (tokens[i].type === "s_close" || tokens[i].type === "del_close")) {
          i++;
        }
      } else if (token.type === "code_inline") {
        runs.push(new TextRun({ 
          text: token.content || "",
          font: "Courier New",
          bold: bold,
          italics: italic,
          strike: strike
        }));
        i++;
      } else if (token.type === "html_inline") {
        // Handle HTML tags like <s>text</s> or <del>text</del>
        const htmlContent = token.content || "";
        if (htmlContent.match(/^<s[>\s]|^<del[>\s]/i)) {
          // Opening strikethrough tag - parse content recursively with strike enabled
          i++;
          const result = parseInlineTokens(tokens, i, bold, italic, true);
          runs.push(...result.runs);
          i = result.nextIndex;
        } else if (htmlContent.match(/^<\/s>|^<\/del>/i)) {
          // Closing strikethrough tag - return to caller
          return { runs, nextIndex: i };
        } else {
          // Other HTML - extract text content
          const textMatch = htmlContent.match(/>([^<]+)</);
          if (textMatch) {
            runs.push(new TextRun({
              text: textMatch[1],
              bold: bold,
              italics: italic,
              strike: strike
            }));
          }
          i++;
        }
      } else if (token.type === "strong_close" || token.type === "em_close" || token.type === "s_close" || token.type === "del_close") {
        // Return when we hit a closing tag (caller will handle it)
        return { runs, nextIndex: i };
      } else if (token.children) {
        // Process children with current formatting
        const result = parseInlineTokens(token.children, 0, bold, italic, strike);
        runs.push(...result.runs);
        i++;
      } else {
        i++;
      }
    }
    
    return { runs, nextIndex: i };
  }
  
  // Helper function to extract text from inline tokens (for simpler cases)
  function getTextFromTokens(tokens: any[]): string {
    let text = "";
    for (const token of tokens) {
      if (token.type === "text") {
        text += token.content;
      } else if (token.children) {
        text += getTextFromTokens(token.children);
      }
    }
    return text;
  }
  
  // Convert markdown tokens to DOCX paragraphs
  const paragraphs: Paragraph[] = [];
  
  // Add title paragraph (strip markdown from title)
  const plainTitle = markdownToPlainText(title);
  paragraphs.push(
    new Paragraph({
      children: [
        new TextRun({
          text: plainTitle,
          bold: true,
          size: 32
        })
      ],
      spacing: { after: 200 }
    })
  );
  
  // Process content tokens
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    
    if (token.type === "heading_open") {
      const level = parseInt(token.tag.substring(1)); // h1 -> 1, h2 -> 2, etc.
      i++; // Skip to content
      const headingText = getTextFromTokens(tokens[i].children || []);
      i++; // Skip content token
      i++; // Skip closing tag
      
      const headingLevels = [
        HeadingLevel.HEADING_1,
        HeadingLevel.HEADING_2,
        HeadingLevel.HEADING_3,
        HeadingLevel.HEADING_4,
        HeadingLevel.HEADING_5,
        HeadingLevel.HEADING_6
      ];
      
      paragraphs.push(
        new Paragraph({
          text: headingText,
          heading: headingLevels[Math.min(level - 1, 5)],
          spacing: { after: 200 }
        })
      );
    } else if (token.type === "paragraph_open") {
      i++; // Skip to content
      const inlineTokens = tokens[i].children || [];
      const result = parseInlineTokens(inlineTokens);
      
      if (result.runs.length > 0) {
        paragraphs.push(
          new Paragraph({
            children: result.runs,
            spacing: { after: 120 }
          })
        );
      } else {
        // Empty paragraph
        paragraphs.push(
          new Paragraph({
            children: [new TextRun({ text: "" })],
            spacing: { after: 120 }
          })
        );
      }
      i++; // Skip content token
      i++; // Skip closing tag
    } else if (token.type === "bullet_list_open") {
      i++; // Process list items
      while (i < tokens.length && tokens[i].type !== "bullet_list_close") {
        if (tokens[i].type === "list_item_open") {
          i++; // Skip list_item_open
          
          // List items may contain paragraph_open, so we need to extract runs from all children
          const runs: TextRun[] = [];
          while (i < tokens.length && tokens[i].type !== "list_item_close") {
            if (tokens[i].type === "paragraph_open") {
              i++; // Skip paragraph_open
              // Extract runs from paragraph content
              if (tokens[i] && tokens[i].children) {
                const result = parseInlineTokens(tokens[i].children);
                runs.push(...result.runs);
              }
              i++; // Skip paragraph content token
              i++; // Skip paragraph_close
            } else if (tokens[i].children) {
              const result = parseInlineTokens(tokens[i].children);
              runs.push(...result.runs);
              i++;
            } else {
              i++;
            }
          }
          i++; // Skip list_item_close
          
          paragraphs.push(
            new Paragraph({
              children: [
                new TextRun({ text: "• ", bold: true }),
                ...runs
              ],
              spacing: { after: 60 },
              indent: { left: 400 }
            })
          );
        } else {
          i++;
        }
      }
      i++; // Skip closing tag
    } else if (token.type === "ordered_list_open") {
      let listIndex = 1;
      i++; // Process list items
      while (i < tokens.length && tokens[i].type !== "ordered_list_close") {
        if (tokens[i].type === "list_item_open") {
          i++; // Skip list_item_open
          
          // List items may contain paragraph_open, so we need to extract runs from all children
          const runs: TextRun[] = [];
          while (i < tokens.length && tokens[i].type !== "list_item_close") {
            if (tokens[i].type === "paragraph_open") {
              i++; // Skip paragraph_open
              // Extract runs from paragraph content
              if (tokens[i] && tokens[i].children) {
                const result = parseInlineTokens(tokens[i].children);
                runs.push(...result.runs);
              }
              i++; // Skip paragraph content token
              i++; // Skip paragraph_close
            } else if (tokens[i].children) {
              const result = parseInlineTokens(tokens[i].children);
              runs.push(...result.runs);
              i++;
            } else {
              i++;
            }
          }
          i++; // Skip list_item_close
          
          paragraphs.push(
            new Paragraph({
              children: [
                new TextRun({ text: `${listIndex}. `, bold: true }),
                ...runs
              ],
              spacing: { after: 60 },
              indent: { left: 400 }
            })
          );
          listIndex++;
        } else {
          i++;
        }
      }
      i++; // Skip closing tag
    } else if (token.type === "blockquote_open") {
      i++; // Skip to content
      const inlineTokens = tokens[i].children || [];
      // Parse with italic enabled by default
      const result = parseInlineTokens(inlineTokens, 0, false, true);
      i++; // Skip content
      i++; // Skip closing tag
      
      paragraphs.push(
        new Paragraph({
          children: result.runs,
          spacing: { after: 120 },
          indent: { left: 400 }
        })
      );
    } else if (token.type === "code_block" || token.type === "fence") {
      const codeText = token.content || "";
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({ 
              text: codeText,
              font: "Courier New"
            })
          ],
          spacing: { after: 120 }
        })
      );
      i++;
    } else {
      i++;
    }
  }
  
  const doc = new Document({
    sections: [
      {
        children: paragraphs
      }
    ]
  });

  const buffer = await Packer.toBuffer(doc);
  const uint8Array = new Uint8Array(buffer);

  return new NextResponse(uint8Array, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${filename}"`
    }
  });
}

