from agentflow_rag.cleaning import CLEANING_STRATEGY_VERSION, clean_policy_pages
from agentflow_rag.schemas import PolicyPage


def test_markdown_cleaning_normalizes_characters_and_adjacent_duplicates() -> None:
    pages, stats = clean_policy_pages(
        [
            PolicyPage(
                text=(
                    "\ufeff＃ 政策\u200b标题\r\n\r\n"
                    "相同政策段落。\r\n\r\n相同政策段落。\r\n\r\n\r\n有效结论。"
                )
            )
        ],
        source_format="markdown",
    )

    assert CLEANING_STRATEGY_VERSION == "policy-text-cleaning-v1"
    assert pages[0].text == "# 政策标题\n\n相同政策段落。\n\n有效结论。"
    assert stats.input_pages == 1
    assert stats.output_pages == 1
    assert stats.removed_duplicate_paragraphs == 1
    assert stats.removed_characters > 0


def test_pdf_cleaning_removes_repeated_edges_and_preserves_page_numbers() -> None:
    pages, stats = clean_policy_pages(
        [
            PolicyPage(
                text="企业内部政策\n第一行未结束\n继续说明。\n1",
                page=1,
            ),
            PolicyPage(
                text="企业内部政策\n第二页正文完整。\n2",
                page=2,
            ),
            PolicyPage(
                text="企业内部政策\n第三页正文完整。\n3",
                page=3,
            ),
        ],
        source_format="pdf",
    )

    assert [page.page for page in pages] == [1, 2, 3]
    assert all("企业内部政策" not in page.text for page in pages)
    assert pages[0].text == "第一行未结束继续说明。"
    assert stats.removed_headers_footers == 3
    assert stats.removed_page_numbers == 3
    assert stats.repaired_line_breaks == 1


def test_pdf_cleaning_does_not_remove_single_page_edges() -> None:
    pages, stats = clean_policy_pages(
        [PolicyPage(text="单页标题\n\n正文内容完整。", page=7)],
        source_format="pdf",
    )

    assert pages[0].page == 7
    assert pages[0].text == "单页标题\n\n正文内容完整。"
    assert stats.removed_headers_footers == 0
