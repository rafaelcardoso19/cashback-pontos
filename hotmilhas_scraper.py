#!/usr/bin/env python3
"""Consulta pública da HotMilhas e grava a cotação LATAM Pass/150 dias em quote.json.

Este script é um ponto de partida: a HotMilhas pode alterar o formulário/fluxo a qualquer momento.
Não contorna autenticação, CAPTCHA ou outras proteções. Se a página não retornar os dados esperados,
encerra sem substituir a última cotação válida.
"""
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

BASE_URL = os.getenv("HOTMILHAS_URL", "https://hotmilhas.com.br/")
OUTPUT = Path(os.getenv("QUOTE_OUTPUT", "quote.json"))
QUANTITY = os.getenv("HOTMILHAS_MILES", "100000")
TIMEOUT_MS = int(os.getenv("HOTMILHAS_TIMEOUT_MS", "45000"))


def brl_to_float(value: str) -> float:
    value = value.replace("R$", "").replace(" ", "").replace(".", "").replace(",", ".")
    return float(value)


def read_old_quote():
    try:
        return json.loads(OUTPUT.read_text(encoding="utf-8"))
    except Exception:
        return None


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(locale="pt-BR", timezone_id="America/Sao_Paulo")
        page.set_default_timeout(TIMEOUT_MS)
        try:
            page.goto(BASE_URL, wait_until="domcontentloaded")
            # O resultado é lido diretamente na tela. Não configuramos nem exigimos e-mail.
            # Se a HotMilhas tornar o e-mail obrigatório para enviar a simulação, a execução
            # falhará com diagnóstico em vez de inventar um endereço ou enviar dados pessoais.
            email_fields = page.get_by_label(re.compile(r"e-?mail", re.I))
            if email_fields.count() > 0:
                print("Campo de e-mail encontrado; será deixado em branco para testar a consulta pública.")

            # O telefone é opcional no formulário mostrado publicamente; não preenchemos esse campo.
            selects = page.locator("select")
            selected = False
            for i in range(selects.count()):
                select = selects.nth(i)
                options = select.locator("option").all_text_contents()
                if any("latam" in opt.lower() for opt in options):
                    # Preferir opção que corresponda a LATAM Pass.
                    for opt in options:
                        if "latam" in opt.lower():
                            try:
                                select.select_option(label=opt.strip())
                                selected = True
                                break
                            except Exception:
                                continue
                if selected:
                    break
            if not selected:
                raise RuntimeError("Não localizei o seletor público de programa LATAM Pass.")

            # Quantidade costuma ser um campo numérico/textual no formulário da página inicial.
            quantity_field = page.get_by_label(re.compile("quantidade de milhas", re.I)).first
            quantity_field.fill(QUANTITY)

            page.get_by_role("button", name=re.compile("cotar minhas milhas", re.I)).click()
            # Espera a tela de resultados renderizar uma opção com prazo de 150 dias.
            awaitable_text = page.get_by_text(re.compile(r"150\s*dias\s*corridos", re.I)).first
            awaitable_text.wait_for(state="visible", timeout=TIMEOUT_MS)
            body_text = page.locator("body").inner_text()

            # Isola um bloco próximo de 150 dias e lê o milheiro explícito; não usa o total da negociação.
            match = re.search(
                r".{0,250}150\s*dias\s*corridos.{0,500}?Milheiro\s*:\s*R\$\s*([\d.]+,\d{2})",
                body_text,
                flags=re.I | re.S,
            )
            if not match:
                # Alternativa se a interface posicionar primeiro o preço e depois o prazo.
                pos = re.search(r"150\s*dias\s*corridos", body_text, re.I)
                if pos:
                    nearby = body_text[max(0, pos.start()-500):pos.end()+700]
                    match = re.search(r"Milheiro\s*:\s*R\$\s*([\d.]+,\d{2})", nearby, re.I)
            if not match:
                raise RuntimeError("A página abriu, mas não consegui confirmar o preço do milheiro para 150 dias.")

            milheiro = brl_to_float(match.group(1))
            if not (0.01 <= milheiro <= 1000):
                raise RuntimeError(f"Valor fora da faixa esperada: {milheiro}")

            now = datetime.now(ZoneInfo("America/Sao_Paulo"))
            old = read_old_quote() or {}
            quote = {
                "programa": "LATAM Pass",
                "prazo_dias": 150,
                "milheiro_brl": round(milheiro, 2),
                "data_cotacao": now.strftime("%Y-%m-%d"),
                "consultado_em": now.isoformat(timespec="seconds"),
                "origem": "HotMilhas — simulação pública",
                "quantidade_teste": int(QUANTITY),
                "status": "validada_por_leitura_automatica",
                "valor_anterior": old.get("milheiro_brl")
            }
            OUTPUT.write_text(json.dumps(quote, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(json.dumps(quote, ensure_ascii=False, indent=2))
            return 0
        except (PlaywrightTimeoutError, Exception) as exc:
            print(f"ERRO: cotação não atualizada: {exc}", file=sys.stderr)
            # Guarda screenshot/HTML para diagnóstico, sem substituir quote.json.
            try:
                page.screenshot(path="hotmilhas-debug.png", full_page=True)
                Path("hotmilhas-debug.html").write_text(page.content(), encoding="utf-8")
                print("Diagnóstico salvo em hotmilhas-debug.png e hotmilhas-debug.html", file=sys.stderr)
            except Exception:
                pass
            return 1
        finally:
            browser.close()

if __name__ == "__main__":
