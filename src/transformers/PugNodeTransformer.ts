import { Transformer } from "./Transformer";
import * as Pug from "../pug";
import * as t from "@babel/types";
import { includes, some, castArray, compact, flatten, find } from "lodash";
import { ScriptNodeTransformer } from "./ScriptNodeTransformer";
import { TagNodeTransformer } from "./TagNodeTransformer";
import { ErrorCode } from "../CompilationError";
import { CaseNodeTransformer } from "./CaseNodeTransformer";
import { ConditionalNodeTransformer } from "./ConditionalNodeTransformer";
import { EachNodeTransformer } from "./EachNodeTransformer";
import { CodeNodeTransformer } from "./CodeNodeTransformer";

export class PugNodeTransformer extends Transformer<Pug.Node, t.Node[]> {
    public isTopLevel = false;
    transform(): void {
        const node = this.input;
        if (Pug.isType<Pug.TagNode>(node, Pug.Type.Tag)) {
            if (
                includes(
                    [
                        "html",
                        "body",
                        "link",
                        "meta",
                        "style", // TODO Fixme
                    ],
                    node.name,
                )
            ) {
                this.pushError({
                    code: ErrorCode.UnsupportedSyntaxError,
                    reasons: [`${node.name} is not supported`],
                    maybeBug: false,
                    isFatal: true,
                    ...Pug.extractPosInfo(this.input),
                });
                return;
            }
            if (node.name === "script") {
                this.transformScriptNode(node);
                return;
            }
            this.transformTagNode(node);
            return;
        }
        if (Pug.isType<Pug.BlockNode>(node, Pug.Type.Block)) {
            this.output = flatten(compact(node.nodes.map(n => this.delegateTo(PugNodeTransformer, n))));
            return;
        }
        if (Pug.isType<Pug.CodeNode>(node, Pug.Type.Code)) {
            this.transformCodeNode(node);
            return;
        }
        if (Pug.isType<Pug.TextNode>(node, Pug.Type.Text)) {
            this.output = [t.jsxText(node.val)];
            return;
        }
        if (Pug.isType<Pug.CaseNode>(node, Pug.Type.Case)) {
            const transformed = this.delegateTo(CaseNodeTransformer, node);
            if (transformed) this.output = [transformed];
            return;
        }
        if (Pug.isType<Pug.ConditionalNode>(node, Pug.Type.Conditional)) {
            const transformed = this.delegateTo(ConditionalNodeTransformer, node);
            if (transformed) this.output = [transformed];
            return;
        }
        if (Pug.isType<Pug.EachNode>(node, Pug.Type.Each)) {
            const transformed = this.delegateTo(EachNodeTransformer, node);
            if (transformed) this.output = [transformed];
            return;
        }
        this.pushError({
            code: ErrorCode.UnsupportedSyntaxError,
            reasons: [`node type ${node.type} is currently not supported`],
            maybeBug: true,
            isFatal: false,
            ...Pug.extractPosInfo(node),
        });
    }

    transformTagNode(node: Pug.TagNode) {
        const codeTransformer = new TagNodeTransformer(node, this.context);
        codeTransformer.transform();
        this.output = codeTransformer.output ? [codeTransformer.output] : undefined;
    }

    transformScriptNode(node: Pug.TagNode) {
        if (some(node.attrs, a => a.name === "src")) {
            this.pushError({
                code: ErrorCode.UnsupportedSyntaxError,
                reasons: [`External script tags are currently not supported`],
                maybeBug: false,
                isFatal: true,
                ...Pug.extractPosInfo(node),
            });
            return;
        }
        const typeAttr = find(node.attrs, a => a.name === "type");
        let scriptType = typeAttr ? `${typeAttr.val}`.replace(/(^('|"))|(('|")$)/g, "") : "text/typescript";
        if (typeAttr && scriptType !== "text/typescript" && scriptType !== "text/molosser") {
            this.pushError({
                code: ErrorCode.UnsupportedSyntaxError,
                reasons: [`Currently only scripts of type text/typescript and text/molosser are supported`],
                maybeBug: false,
                isFatal: true,
                ...Pug.extractPosInfo(node),
            });
            return;
        }
        if (!this.isTopLevel) {
            this.pushError({
                code: ErrorCode.UnsupportedSyntaxError,
                reasons: [`node of type ${node.type} is currently only supported at top level`],
                maybeBug: false,
                isFatal: true,
                ...Pug.extractPosInfo(node),
            });
            return;
        }
        if (scriptType === "text/typescript" && node.block && some(node.block.nodes, n => n.type !== "Text")) {
            this.pushError({
                code: ErrorCode.UnsupportedSyntaxError,
                reasons: [`script or style tags can have only text nodes`],
                maybeBug: false,
                isFatal: true,
                ...Pug.extractPosInfo(node),
            });
        }
        if (scriptType === "text/typescript") {
            this.context.topLevelStatements.push(...(compact(this.delegateTo(ScriptNodeTransformer, node)) as any));
        } else if (scriptType === "text/molosser" && node.block) {
            this.context.topLevelStatements.push(...(compact(this.delegateTo(PugNodeTransformer, node.block)) as any));
        }
        this.output = [];
    }

    transformCodeNode(n: Pug.CodeNode) {
        const codeTransformer = new CodeNodeTransformer(n, this.context);
        codeTransformer.isExpression = n.buffer;
        codeTransformer.transform();
        this.output = codeTransformer.output;
    }
}
