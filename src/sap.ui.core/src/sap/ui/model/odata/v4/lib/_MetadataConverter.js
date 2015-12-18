/*!
 * ${copyright}
 */

//Provides class sap.ui.model.odata.v4.lib._MetadataConverter
sap.ui.define(["./_Helper"], function (Helper) {
	"use strict";

	var MetadataConverter,
		rCollection = /^Collection\((.*)\)$/,
		oAliasConfig = {
			"Reference" : {
				"Include" : {__processor : processAlias}
			},
			"DataServices" : {
				"Schema" : {__processor : processAlias}
			}
		},
		oStructuredTypeConfig = {
			"Property" : {
				__processor : processTypeProperty
			},
			"NavigationProperty" : {
				__processor : processTypeNavigationProperty,
				"OnDelete" : {
					__processor : processTypeNavigationPropertyOnDelete
				},
				"ReferentialConstraint" : {
					__processor : processTypeNavigationPropertyReferentialConstraint
				}
			}
		},
		oEntitySetConfig = {
			"NavigationPropertyBinding" : {
				__processor : processNavigationPropertyBinding
			}
		},
		oActionOrFunctionConfig = {
			"Parameter" : {
				__processor : processParameter
			},
			"ReturnType" : {
				__processor : processReturnType
			}
		},
		// All Annotations elements that don't have expressions as child (leaf, non-recursive)
		oAnnotationLeafConfig = {
			"AnnotationPath" : {__postProcessor : postProcessLeaf},
			"Binary" : {__postProcessor : postProcessLeaf},
			"Bool" : {__postProcessor : postProcessLeaf},
			"Date" : {__postProcessor : postProcessLeaf},
			"DateTimeOffset" : {__postProcessor : postProcessLeaf},
			"Decimal" : {__postProcessor : postProcessLeaf},
			"Duration" : {__postProcessor : postProcessLeaf},
			"EnumMember" : {__postProcessor : postProcessLeaf},
			"Float" : {__postProcessor : postProcessLeaf},
			"Guid" : {__postProcessor : postProcessLeaf},
			"Int" : {__postProcessor : postProcessLeaf},
			"LabeledElementReference" : {__postProcessor : postProcessLabeledElementReference},
			"NavigationPropertyPath" : {__postProcessor : postProcessLeaf},
			"Null" : {__postProcessor : postProcessLeaf},
			"Path" : {__postProcessor : postProcessLeaf},
			"PropertyPath" : {__postProcessor : postProcessLeaf},
			"String" : {__postProcessor : postProcessLeaf},
			"TimeOfDay" : {__postProcessor : postProcessLeaf}
		},
		oFullConfig = {
			__processor : processEdmx,
			"Reference" : {
				__processor : processReference,
				"Include" : {
					__processor: processInclude
				},
				"IncludeAnnotations" : {
					__processor: processIncludeAnnotations
				}
			},
			"DataServices" : {
				"Schema" : {
					__processor : processSchema,
					"Action" : {
						__processor : processActionOrFunction,
						__include : oActionOrFunctionConfig
					},
					"Annotations" : {
						__processor : processAnnotations,
						"Annotation" : {
							__processor : processAnnotation,
							__postProcessor : postProcessAnnotation,
							__include : oAnnotationLeafConfig
						}
					},
					"Function" : {
						__processor : processActionOrFunction,
						__include : oActionOrFunctionConfig
					},
					"EntityType" : {
						__processor : processEntityType,
						__include : oStructuredTypeConfig,
						"Key" : {
							"PropertyRef" : {
								__processor : processEntityTypeKeyPropertyRef
							}
						}
					},
					"ComplexType" : {
						__processor : processComplexType,
						__include : oStructuredTypeConfig
					},
					"EntityContainer" : {
						__processor : processEntityContainer,
						"ActionImport" : {
							__processor : processImport.bind(null, "Action")
						},
						"EntitySet" : {
							__processor : processEntitySet,
							__include : oEntitySetConfig
						},
						"FunctionImport" : {
							__processor : processImport.bind(null, "Function")
						},
						"Singleton" : {
							__processor : processSingleton,
							__include : oEntitySetConfig
						}
					},
					"EnumType" : {
						__processor : processEnumType,
						"Member" : {
							__processor : processEnumTypeMember
						}
					},
					"Term" : {
						__processor : processTerm
					},
					"TypeDefinition" : {
						__processor : processTypeDefinition
					}
				}
			}
		};

	/**
	 * Returns the attributes of the DOM Element as map.
	 *
	 * @param {Element} oElement the element
	 * @returns {object} the attributes
	 */
	function getAttributes(oElement) {
		var oAttribute, oAttributeList = oElement.attributes, i, oResult = {};

		for (i = 0; i < oAttributeList.length; i++) {
			oAttribute = oAttributeList.item(i);
			oResult[oAttribute.name] = oAttribute.value;
		}
		return oResult;
	}

	/**
	 * Fetches the array at the given property. Ensures that there is at least an empty array.
	 * @param {object} oParent the parent object
	 * @param {string} sProperty the property name
	 * @returns {any[]} the array at the given property
	 */
	function getOrCreateArray(oParent, sProperty) {
		var oResult = oParent[sProperty];

		if (!oResult) {
			oResult = oParent[sProperty] = [];
		}
		return oResult;
	}

	/**
	 * Fetches the object at the given property. Ensures that there is at least an empty object.
	 * @param {object} oParent the parent object
	 * @param {string} sProperty the property name
	 * @returns {object} the object at the given property
	 */
	function getOrCreateObject(oParent, sProperty) {
		var oResult = oParent[sProperty];

		if (!oResult) {
			oResult = oParent[sProperty] = {};
		}
		return oResult;
	}

	/**
	 * Determines the value for an annotation of the given type.
	 * @param {string} sType
	 *   the annotation type (either from the attribute name in the Annotation element or from the
	 *   element name itself)
	 * @param {string} sValue
	 *   the value in the XML (either the attribute value or the element's text value)
	 * @param {object} oAggregate
	 *   the aggregate
	 * @returns {any}
	 *   the value for the JSON
	 */
	function getAnnotationValue(sType, sValue, oAggregate) {
		var vValue, aValues;

		switch (sType) {
			case "AnnotationPath":
			case "NavigationPropertyPath":
			case "Path":
			case "PropertyPath":
				sValue = MetadataConverter.resolveAliasInPath(sValue, oAggregate);
				// falls through
			case "Binary":
			case "Date":
			case "DateTimeOffset":
			case "Decimal":
			case "Duration":
			case "Guid":
			case "TimeOfDay":
			case "UrlRef":
				vValue = {};
				vValue["$" + sType] = sValue;
				return vValue;
			case "Bool":
				return sValue === "true";
			case "EnumMember":
				aValues = sValue.split(" ");
				aValues.forEach(function (sPath, i) {
					aValues[i] = MetadataConverter.resolveAliasInPath(sPath, oAggregate);
				});
				return {$EnumMember: aValues.join(" ")};
			case "Float":
				if (sValue === "NaN" || sValue === "INF" || sValue === "-INF") {
					return {$Float: sValue};
				}
				return parseFloat(sValue);
			case "Int":
				vValue = parseInt(sValue, 10);
				return Helper.isSafeInteger(vValue) ? vValue : {$Int: sValue};
			case "Null":
				return null;
			case "String":
				return sValue;
			default:
				return true;
		}
	}

	/**
	 * Post-processing of an Annotation element. Sets the result of the single child element at the
	 * annotation if there was a child.
	 *
	 * @param {Element} oElement the element
	 * @param {any[]} aResult the results from child elements
	 * @param {object} oAggregate the aggregate
	 */
	function postProcessAnnotation(oElement, aResult, oAggregate) {
		if (aResult) {
			oAggregate.annotations.target[oAggregate.annotations.qualifiedName] = aResult[0];
		}
	}

	/**
	 * Post-processing of a LabeledElementReference element within an Annotation element.
	 *
	 * @param {Element} oElement the element
	 * @param {any[]} aResult the results from child elements
	 * @param {object} oAggregate the aggregate
	 * @returns {any} the constant value for the JSON
	 */
	function postProcessLabeledElementReference(oElement, aResult, oAggregate) {
		return {
			"$LabeledElementReference" :
				MetadataConverter.resolveAlias(oElement.textContent, oAggregate)
		};
	}

	/**
	 * Post-processing of a leaf element within an Annotation element.
	 *
	 * @param {Element} oElement the element
	 * @param {any[]} aResult the results from child elements
	 * @param {object} oAggregate the aggregate
	 * @returns {any} the constant value for the JSON
	 */
	function postProcessLeaf(oElement, aResult, oAggregate) {
		return getAnnotationValue(oElement.localName, oElement.textContent, oAggregate);
	}

	/**
	 * Processes an Action or Function element.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 */
	function processActionOrFunction(oElement, oAggregate) {
		var sKind = oElement.localName,
			oAttributes = getAttributes(oElement),
			sQualifiedName = oAggregate.namespace + "." + oAttributes.Name,
			aActions = oAggregate.result[sQualifiedName] || [],
			oAction = {
				$kind: sKind,
				$Parameter: []
			};

		processAttributes(oAttributes, oAction, {
			"IsBound" : setIfTrue,
			"EntitySetPath" : setValue,
			"IsComposable" : setIfTrue
		});

		oAggregate.result[sQualifiedName] = aActions.concat(oAction);
		oAggregate.actionOrFunction = oAction;
	}

	/**
	 * Extracts the Aliases from the Include and Schema elements.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 */
	function processAlias(oElement, oAggregate) {
		var oAttributes = getAttributes(oElement);

		if (oAttributes.Alias) {
			oAggregate.aliases[oAttributes.Alias] = oAttributes.Namespace;
		}
	}

	/**
	 * Processes an Annotations element.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 */
	function processAnnotations(oElement, oAggregate) {
		var oAttributes = getAttributes(oElement),
			sTargetName = MetadataConverter.resolveAliasInPath(oAttributes.Target, oAggregate),
			oTarget = {};

		if (!oAggregate.schema.$Annotations) {
			oAggregate.schema.$Annotations = {};
		}
		oAggregate.schema.$Annotations[sTargetName] = oTarget;
		oAggregate.annotations =  {
			target: oTarget,
			qualifier: oAttributes.Qualifier
		};
	}

	/**
	 * Processes an Annotation element within Annotations.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 */
	function processAnnotation(oElement, oAggregate) {
		var oAttributes = getAttributes(oElement),
			sKey,
			sQualifiedName = "@" + MetadataConverter.resolveAlias(oAttributes.Term, oAggregate),
			sQualifier = oAggregate.annotations.qualifier || oAttributes.Qualifier,
			vValue = true;

		if (sQualifier) {
			sQualifiedName += "#" + sQualifier;
		}

		for (sKey in oAttributes) {
			if (sKey !== "Term" && sKey !== "Qualifier") {
				vValue = getAnnotationValue(sKey, oAttributes[sKey], oAggregate);
				break;
			}
		}

		oAggregate.annotations.qualifiedName = sQualifiedName;
		oAggregate.annotations.target[sQualifiedName] = vValue;
	}

	/**
	 * Copies all attributes from oAttributes to oTarget according to oConfig.
	 * @param {object} oAttributes the attribute of an Element as returned by getAttributes
	 * @param {object} oTarget the target object
	 * @param {object} oConfig
	 *   the configuration: each property describes a property of oAttributes to copy; the value is
	 *   a conversion function, if this function returns undefined, the property is not set
	 */
	function processAttributes(oAttributes, oTarget, oConfig) {
		Object.keys(oConfig).forEach(function (sProperty) {
			var sValue = oConfig[sProperty](oAttributes[sProperty]);
			if (sValue !== undefined) {
				oTarget["$" + sProperty] = sValue;
			}
		});
	}

	/**
	 * Processes a ComplexType element.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 */
	function processComplexType(oElement, oAggregate) {
		processType(oElement, oAggregate, {"$kind" : "ComplexType"});
	}

	/**
	 * Processes the Edmx element.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 */
	function processEdmx(oElement, oAggregate) {
		processAttributes(getAttributes(oElement), oAggregate.result, {
			"Version": setValue
		});
	}

	/**
	 * Processes an EntityContainer element.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 */
	function processEntityContainer(oElement, oAggregate) {
		var sQualifiedName = oAggregate.namespace + "." + oElement.getAttribute("Name");
		oAggregate.result[sQualifiedName] = oAggregate.entityContainer = {
			"$kind" : "EntityContainer"
		};
		oAggregate.result.$EntityContainer = sQualifiedName;
	}

	/**
	 * Processes an EntitySet element at the EntityContainer.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 */
	function processEntitySet(oElement, oAggregate) {
		var oAttributes = getAttributes(oElement);
		oAggregate.entityContainer[oAttributes.Name] = oAggregate.entitySet = {
			$kind : "EntitySet",
			$Type : MetadataConverter.resolveAlias(oAttributes.EntityType, oAggregate)
		};
		if (oAttributes.IncludeInServiceDocument === "false") {
			oAggregate.entitySet.$IncludeInServiceDocument = false;
		}
	}

	/**
	 * Processes an EntityType element.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 */
	function processEntityType(oElement, oAggregate) {
		processType(oElement, oAggregate, {
			$kind: "EntityType",
			$Key : []
		});
	}

	/**
	 * Processes a PropertyRef element of the EntityType's Key.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 */
	function processEntityTypeKeyPropertyRef(oElement, oAggregate) {
		var oAttributes = getAttributes(oElement),
			vKey;

		if (oAttributes.Alias) {
			vKey = {};
			vKey[oAttributes.Alias] = oAttributes.Name;
		} else {
			vKey = oAttributes.Name;
		}
		oAggregate.type.$Key = oAggregate.type.$Key.concat(vKey);
	}

	/**
	 * Processes an EnumType element.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 */
	function processEnumType(oElement, oAggregate) {
		var oAttributes = getAttributes(oElement),
			sQualifiedName = oAggregate.namespace + "." + oAttributes.Name,
			oEnumType = {
				"$kind": "EnumType"
			};

		processAttributes(oAttributes, oEnumType, {
			"IsFlags" : setIfTrue,
			"UnderlyingType" : function (sValue) {
				return sValue !== "Edm.Int32" ? sValue : undefined;
			}
		});

		oAggregate.result[sQualifiedName] = oAggregate.enumType = oEnumType;
		oAggregate.enumTypeMemberCounter = 0;
	}

	/**
	 * Processes an Member element within a EnumType.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 */
	function processEnumTypeMember(oElement, oAggregate) {
		var oAttributes = getAttributes(oElement),
			vValue = oAttributes.Value;

		if (vValue) {
			vValue = parseInt(vValue, 10);
			if (!Helper.isSafeInteger(vValue)) {
				vValue = oAttributes.Value;
			}
		} else {
			vValue = oAggregate.enumTypeMemberCounter;
			oAggregate.enumTypeMemberCounter++;
		}
		oAggregate.enumType[oAttributes.Name] = vValue;
	}

	/**
	 * Processes an ActionImport or FunctionImport element.
	 * @param {string} sWhat "Action" or "Function"
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 */
	function processImport(sWhat, oElement, oAggregate) {
		var oAttributes = getAttributes(oElement),
			oImport = {
				$kind: sWhat + "Import"
			};

		oImport["$" + sWhat] = MetadataConverter.resolveAlias(oAttributes[sWhat], oAggregate);
		processAttributes(oAttributes, oImport, {
			"EntitySet" : function (sValue) {
				return resolveTargetPath(sValue, oAggregate);
			},
			"IncludeInServiceDocument" : setIfFalse
		});

		oAggregate.entityContainer[oAttributes.Name] = oImport;
	}

	/**
	 * Processes an Include element within a Reference.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 */
	function processInclude(oElement, oAggregate) {
		var oInclude = getOrCreateArray(oAggregate.reference, "$Include");
		oInclude.push(oElement.getAttribute("Namespace"));
	}

	/**
	 * Processes an IncludeAnnotations element within a Reference.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 */
	function processIncludeAnnotations(oElement, oAggregate) {
		var oAttributes = getAttributes(oElement),
			oReference = oAggregate.reference,
			oIncludeAnnotation = {
				"$TermNamespace" : oAttributes.TermNamespace
			},
			aIncludeAnnotations = getOrCreateArray(oReference, "$IncludeAnnotations");

		processAttributes(oAttributes, oIncludeAnnotation, {
			"TargetNamespace" : setValue,
			"Qualifier" : setValue
		});

		aIncludeAnnotations.push(oIncludeAnnotation);
	}

	/**
	 * Processes a NavigationPropertyBinding element within an EntitySet or Singleton.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 */
	function processNavigationPropertyBinding(oElement, oAggregate) {
		var oAttributes = getAttributes(oElement),
			oNavigationPropertyBinding = oAggregate.entitySet.$NavigationPropertyBinding;

		if (!oNavigationPropertyBinding) {
			oAggregate.entitySet.$NavigationPropertyBinding = oNavigationPropertyBinding = {};
		}
		oNavigationPropertyBinding[oAttributes.Path]
			= resolveTargetPath(oAttributes.Target, oAggregate);
	}

	/**
	 * Processes a Parameter element within an Action or Function.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 */
	function processParameter(oElement, oAggregate) {
		var oAttributes = getAttributes(oElement),
			oActionOrFunction = oAggregate.actionOrFunction,
			oParameter = {};

		processTypedCollection(oAttributes.Type, oParameter, oAggregate);
		processAttributes(oAttributes, oParameter, {
			"Name" : setValue,
			"Nullable" : setIfFalse
		});
		MetadataConverter.processFacetAttributes(oAttributes, oParameter);

		oActionOrFunction.$Parameter.push(oParameter);
	}

	/**
	 * Processes a Reference element.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 */
	function processReference(oElement, oAggregate) {
		var oReference = getOrCreateObject(oAggregate.result, "$Reference");

		oAggregate.reference = oReference[oElement.getAttribute("Uri")] = {};
	}

	/**
	 * Processes a ReturnType element within an Action or Function.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 */
	function processReturnType(oElement, oAggregate) {
		var oAttributes = getAttributes(oElement),
			oActionOrFunction = oAggregate.actionOrFunction,
			oReturnType = {};

		processTypedCollection(oAttributes.Type, oReturnType, oAggregate);
		processAttributes(oAttributes, oReturnType, {
			"Nullable" : setIfFalse
		});
		MetadataConverter.processFacetAttributes(oAttributes, oReturnType);

		oActionOrFunction.$ReturnType = oReturnType;
	}

	/**
	 * Processes a Schema element.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 */
	function processSchema(oElement, oAggregate) {
		oAggregate.namespace = oElement.getAttribute("Namespace");
		oAggregate.result[oAggregate.namespace] = oAggregate.schema = {
			"$kind": "Schema"
		};
	}

	/**
	 * Processes a Singleton element at the EntityContainer.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 */
	function processSingleton(oElement, oAggregate) {
		var oAttributes = getAttributes(oElement);
		oAggregate.entityContainer[oAttributes.Name] = oAggregate.entitySet = {
			$kind : "Singleton",
			$Type : MetadataConverter.resolveAlias(oAttributes.Type, oAggregate)
		};
	}

	/**
	 * Processes a Term element.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 */
	function processTerm(oElement, oAggregate) {
		var oAttributes = getAttributes(oElement),
			sQualifiedName = oAggregate.namespace + "." + oAttributes.Name,
			oTerm = {
				$kind: "Term"
			};

		processTypedCollection(oAttributes.Type, oTerm, oAggregate);
		processAttributes(oAttributes, oTerm, {
			"Nullable" : setIfFalse,
			"BaseTerm" : function (sValue) {
				return sValue ? MetadataConverter.resolveAlias(sValue, oAggregate) : undefined;
			}
		});
		MetadataConverter.processFacetAttributes(oAttributes, oTerm);

		oAggregate.result[sQualifiedName] = oTerm;
	}

	/**
	 * Processes a ComplexType or EntityType element.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 * @param {object} oType the initial typed result object
	 */
	function processType(oElement, oAggregate, oType) {
		var oAttributes = getAttributes(oElement),
			sQualifiedName = oAggregate.namespace + "." + oAttributes.Name;

		processAttributes(oAttributes, oType, {
			"OpenType" : setIfTrue,
			"HasStream" : setIfTrue,
			"Abstract" : setIfTrue,
			"BaseType" : setValue
		});

		oAggregate.result[sQualifiedName] = oAggregate.type = oType;
	}

	/**
	 * Processes the type in the form "Type" or "Collection(Type)" and sets the appropriate
	 * properties.
	 * @param {string} sType the type attribute from the Element
	 * @param {object} oProperty the property attribute in the JSON
	 * @param {object} oAggregate the aggregate
	 */
	function processTypedCollection(sType, oProperty, oAggregate) {
		var aMatches = rCollection.exec(sType);

		if (aMatches) {
			oProperty.$isCollection = true;
			sType = aMatches[1];
		}
		oProperty.$Type = MetadataConverter.resolveAlias(sType, oAggregate);
	}

	/**
	 * Processes an TypeDefinition element.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 */
	function processTypeDefinition(oElement, oAggregate) {
		var oAttributes = getAttributes(oElement),
			sQualifiedName = oAggregate.namespace + "." + oAttributes.Name,
			oTypeDefinition = {
				"$kind" : "TypeDefinition",
				"$UnderlyingType" : oAttributes.UnderlyingType
			};

		oAggregate.result[sQualifiedName] = oTypeDefinition;
		MetadataConverter.processFacetAttributes(oAttributes, oTypeDefinition);
	}

	/**
	 * Processes a NavigationProperty element of a structured type.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 */
	function processTypeNavigationProperty(oElement, oAggregate) {
		var oAttributes = getAttributes(oElement),
			oProperty = {
				$kind : "NavigationProperty"
			};

		processTypedCollection(oAttributes.Type, oProperty, oAggregate);
		processAttributes(oAttributes, oProperty, {
			"Nullable" : setIfFalse,
			"Partner" : setValue,
			"ContainsTarget" : setIfTrue
		});

		oAggregate.type[oAttributes.Name] = oAggregate.navigationProperty = oProperty;
	}

	/**
	 * Processes a NavigationProperty OnDelete element.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 */
	function processTypeNavigationPropertyOnDelete(oElement, oAggregate) {
		oAggregate.navigationProperty.$OnDelete = oElement.getAttribute("Action");
	}

	/**
	 * Processes a NavigationProperty OnDelete element.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 */
	function processTypeNavigationPropertyReferentialConstraint(oElement, oAggregate) {
		var oAttributes = getAttributes(oElement),
			oReferentialConstraint = oAggregate.navigationProperty.$ReferentialConstraint;

		if (!oReferentialConstraint) {
			oAggregate.navigationProperty.$ReferentialConstraint = oReferentialConstraint = {};
		}

		oReferentialConstraint[oAttributes.Property] = oAttributes.ReferencedProperty;
	}

	/**
	 * Processes a Property element of a structured type.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 */
	function processTypeProperty(oElement, oAggregate) {
		var oAttributes = getAttributes(oElement),
			oProperty = {
				"$kind" : "Property"
			};

		processTypedCollection(oAttributes.Type, oProperty, oAggregate);
		processAttributes(oAttributes, oProperty, {
			"Nullable" : setIfFalse,
			"DefaultValue" : setValue
		});
		MetadataConverter.processFacetAttributes(oAttributes, oProperty);

		oAggregate.type[oAttributes.Name] = oProperty;
	}

	/**
	 * Resolves a target path including resolve aliases.
	 * @param {string} sPath the target path
	 * @param {object} oAggregate the aggregate containing the aliases
	 * @returns {string} the target path with the alias resolved (if there was one)
	 */
	function resolveTargetPath(sPath, oAggregate) {
		var iSlash;

		if (!sPath) {
			return sPath;
		}

		sPath =  MetadataConverter.resolveAliasInPath(sPath, oAggregate);
		iSlash = sPath.indexOf("/");

		if (iSlash >= 0 && sPath.indexOf("/", iSlash + 1) < 0) { // if there is exactly one slash
			if (sPath.slice(0, iSlash) === oAggregate.result.$EntityContainer) {
				return sPath.slice(iSlash + 1);
			}
		}
		return sPath;
	}

	/**
	 * Helper for processAttributes, returns false if sValue is "false", returns undefined
	 * otherwise.
	 * @param {string} sValue the attribute value in the element
	 * @returns {boolean} false or undefined
	 */
	function setIfFalse(sValue) {
		return sValue === "false" ? false : undefined;
	}

	/**
	 * Helper for processAttributes, returns true if sValue is "true", returns undefined
	 * otherwise.
	 * @param {string} sValue the attribute value in the element
	 * @returns {boolean} true or undefined
	 */
	function setIfTrue(sValue) {
		return sValue === "true" ? true : undefined;
	}

	/**
	 * Helper for processAttributes, returns sValue converted to a number.
	 * @param {string} sValue the attribute value in the element
	 * @returns {number} the value as number or undefined
	 */
	function setNumber(sValue) {
		return sValue ? parseInt(sValue, 10) : undefined;
	}

	/**
	 * Helper for processAttributes, returns sValue.
	 * @param {string} sValue the attribute value in the element
	 * @returns {string} sValue
	 */
	function setValue(sValue) {
		return sValue;
	}

	MetadataConverter = {
		/**
		 * Converts the metadata from XML format to a JSON object.
		 *
		 * @param {Document} oDocument
		 *   the XML DOM document
		 * @returns {object}
		 *   the metadata JSON
		 */
		convertXMLMetadata : function (oDocument) {
			var oAggregate = {
					"actionOrFunction" : null, // the current action or function
					"aliases" : {}, // maps alias -> namespace
					"annotations" : {}, // target: the object to put annotations to
										// qualifier: the current Annotations element's qualifier
					"entityContainer" : null, // the current EntityContainer
					"entitySet" : null, // the current EntitySet/Singleton
					"enumType" : null, // the current EnumType
					"enumTypeMemberCounter" : 0, // the current EnumType member value counter
					"namespace" : null, // the namespace of the current Schema
					"navigationProperty" : null, // the current NavigationProperty
					"reference" : null, // the current Reference
					"schema" : null, // the current Schema
					"type" : null, // the current EntityType/ComplexType
					"result" : {}
				},
				oElement = oDocument.documentElement;

			// first round: find aliases
			MetadataConverter.traverse(oElement, oAggregate, oAliasConfig);
			// second round, full conversion
			MetadataConverter.traverse(oElement, oAggregate, oFullConfig);
			return oAggregate.result;
		},

		/**
		 * Processes the TFacetAttributes and TPropertyFacetAttributes of the elements Property,
		 * TypeDefinition etc.
		 * @param {object} oAttributes the element attributes
		 * @param {object} oResult the result object to fill
		 */
		processFacetAttributes : function (oAttributes, oResult) {
			processAttributes(oAttributes, oResult, {
				"MaxLength" : setNumber,
				"Precision" : setNumber,
				"Scale" : function (sValue) {
					return sValue === "variable" ? sValue : setNumber(sValue);
				},
				"SRID" : setValue,
				"Unicode" : setIfFalse
			});
		},

		/**
		 * Resolves an alias in the given qualified name or full name.
		 * @param {string} sName the name
		 * @param {object} oAggregate the aggregate containing the aliases
		 * @returns {string} the name with the alias resolved (if there was one)
		 */
		resolveAlias : function (sName, oAggregate) {
			var iDot = sName.indexOf("."),
				sNamespace;

			if (iDot >= 0 && sName.indexOf(".", iDot + 1) < 0) { // if there is exactly one dot
				sNamespace = oAggregate.aliases[sName.slice(0, iDot)];
				if (sNamespace) {
					return sNamespace + "." + sName.slice(iDot + 1);
				}
			}
			return sName;
		},

		/**
		 * Resolves all aliases in the given path.
		 * @param {string} sPath the path
		 * @param {object} oAggregate the aggregate containing the aliases
		 * @returns {string} the path with the alias resolved (if there was one)
		 */
		resolveAliasInPath : function (sPath, oAggregate) {
			var iAt, i, aSegments, sTerm = "";

			if (sPath.indexOf(".") < 0) {
				return sPath; // no dot -> nothing to do
			}
			iAt = sPath.indexOf("@");
			if (iAt >= 0) {
				sTerm = "@" + MetadataConverter.resolveAlias(sPath.slice(iAt + 1), oAggregate);
				sPath = sPath.slice(0, iAt);
			}
			aSegments = sPath.split("/");
			for (i = 0; i < aSegments.length; i++) {
				aSegments[i] = MetadataConverter.resolveAlias(aSegments[i], oAggregate);
			}
			return aSegments.join("/") + sTerm;
		},

		/**
		 * Recursively traverses the subtree of a given XML element controlled by the given
		 * (recursive) configuration.
		 *
		 * @param {Element} oElement
		 *   an XML DOM element
		 * @param {object} oAggregate
		 *   an aggregate object that is passed to every processor function
		 * @param {object} oConfig
		 *   the configuration for this element with the following properties:
		 *   * __processor is a function called with this element and oAggregate as parameters
		 *     before visiting the children.
		 *   * __postProcessor is called after visiting the children. It gets an array with all
		 *     return values of the children's __postProcessor functions (or undefined if there
		 *     were no children).
		 *   * __include may give another configuration object that is also searched for known
		 *     children.
		 *   * All other properties are known child elements, the value is the configuration for
		 *     that child element.
		 * @returns {any} return value from __postProcessor or undefined if there is none
		 */
		traverse : function (oElement, oAggregate, oConfig) {
			var oChildList = oElement.childNodes,
				oChildNode, i, oChildConfig,
				vResult, aResult;


			if (oConfig.__processor) {
				oConfig.__processor(oElement, oAggregate);
			}
			for (i = 0; i < oChildList.length; i++) {
				oChildNode = oChildList.item(i);
				if (oChildNode.nodeType === 1) { // Node.ELEMENT_NODE
					oChildConfig = oConfig[oChildNode.localName];
					if (!oChildConfig && oConfig.__include) {
						oChildConfig = oConfig.__include[oChildNode.localName];
					}
					if (oChildConfig) {
						vResult = MetadataConverter.traverse(oChildNode, oAggregate, oChildConfig);
						if (oConfig.__postProcessor) {
							aResult = (aResult || []).concat([vResult]);
						}
					}
				}
			}
			if (oConfig.__postProcessor) {
				return oConfig.__postProcessor(oElement, aResult, oAggregate);
			}
		}
	};

	return MetadataConverter;
}, /* bExport= */false);
